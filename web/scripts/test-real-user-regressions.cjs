// Isolated business regressions: executes production functions with an in-memory transactional DB.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('src/lib/data/repo.ts', 'utf8');
function extract(name, end) {
  const start = source.indexOf(`export async function ${name}(`);
  return source.slice(start, source.indexOf(end, start)).replace('export ', '');
}
let state, calls;
const table = name => ({
  get: async id => structuredClone(state[name][id]),
  put: async row => { state[name][row.id] = structuredClone(row); },
  add: async row => { state[name][Object.keys(state[name]).length] = structuredClone(row); },
  update: async (id, patch) => Object.assign(state[name][id], patch),
  where: () => ({ equals: uuid => ({ first: async () => Object.values(state[name]).find(o => o.client_uuid === uuid) }) }),
});
const d = Object.fromEntries(['stock_counts','stock','audit','pending','employees','orders','shifts','products','branches','terminals','customers','kv'].map(n => [n, table(n)]));
d.transaction = async (...args) => { const before = structuredClone(state); try { return await args.at(-1)(); } catch(e) { state = before; throw e; } };
const context = {
  isLiveMode: () => false, db: () => d, can: (e, key) => e.permissions.includes(key), round2: x => Math.round(x * 100) / 100,
  stockKey: (b,p) => `${b}:${p}`, tl: (th) => th, tr: (th) => th, trL: (th) => th, nanoid: () => `id-${++calls}`, Date, Map,
  adjustStock: async (b,p,delta) => { state.stock[`${b}:${p}`].qty_on_hand += delta; },
  readStockView: async (b,p) => ({available: state.stock[`${b}:${p}`].qty_on_hand}),
  refreshCounts: async () => {}, flush: async () => {},
  commitSaleTx: async draft => { const order = {id:'sale', client_uuid:draft.client_uuid, is_offline_origin:false}; state.orders.sale=order; return {order,offline:false}; },
};
vm.createContext(context);
vm.runInContext(ts.transpile(extract('approveCountSession','\n/**') + '\n' + extract('commitSale','\nasync function commitSaleTx'), {target:ts.ScriptTarget.ES2020}),context);
function reset() {
  calls=0; state=Object.fromEntries(Object.keys(d).filter(k=>k!=='transaction').map(k=>[k,{}]));
  state.employees.manager={id:'manager',status:'active',permissions:['inventory.adjust','pos.sell']};
  state.employees.pc={id:'pc',status:'active',permissions:['pos.sell']};
  state.stock['b:p']={qty_on_hand:4}; state.products.p={is_stocked:true};
  state.stock_counts.c={id:'c',branch_id:'b',count_no:'C',status:'submitted',lines:[{product_id:'p',sku:'SKU',expected:4,counted:6}]};
}
(async()=>{
  reset(); await context.approveCountSession({id:'c'},'manager'); await context.approveCountSession({id:'c'},'manager');
  assert.equal(state.stock['b:p'].qty_on_hand,6); assert.equal(Object.keys(state.pending).length,1);
  reset(); await assert.rejects(context.approveCountSession({id:'c'},'pc'),/forbidden/); assert.equal(state.stock['b:p'].qty_on_hand,4);
  reset(); state.stock['b:p'].qty_on_hand=3; await assert.rejects(context.approveCountSession({id:'c'},'manager'),/stock_changed/);
  reset(); state.stock_counts.c.lines.push({product_id:'missing',expected:1,counted:2});
  await assert.rejects(context.approveCountSession({id:'c'},'manager'),/stock_changed/); assert.equal(state.stock['b:p'].qty_on_hand,4); assert.equal(Object.keys(state.pending).length,0);
  const draft={client_uuid:'once',cashier_id:'pc',branch_id:'b',items:[{product_id:'p',qty:2}]};
  reset(); await context.commitSale(draft); await context.commitSale(draft); assert.equal(Object.keys(state.orders).length,1);
  reset(); await assert.rejects(context.commitSale({...draft,items:[{product_id:'p',qty:3},{product_id:'p',qty:3}]}),/insufficient/);
  reset(); context.commitSaleTx=async()=>{state.orders.partial={};state.stock['b:p'].qty_on_hand=0;throw Error('disk failure');};
  await assert.rejects(context.commitSale(draft),/disk failure/); assert.equal(state.stock['b:p'].qty_on_hand,4); assert.equal(Object.keys(state.orders).length,0);
  console.log('PASS: 7 regressions (repeat approval, PC permission, stale count, rollback, repeat sale, aggregate stock, sale rollback)');
})().catch(e=>{console.error(e);process.exitCode=1;});
