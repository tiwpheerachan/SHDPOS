const fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={exports:{},process:{env:{}}};vm.createContext(ctx);vm.runInContext(ts.transpile(fs.readFileSync('src/lib/permissions.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}),ctx);
const p=ctx.exports,employee={role:'staff',max_discount_percent:5,permission_overrides:{'pos.discount':'deny'}};
assert.equal(p.can(employee,'pos.discount'),false);assert.equal(p.discountLimit(employee),0);
assert.equal(p.needsApproval({...employee,permission_overrides:{'pos.discount':'approval'}},'pos.discount'),true);
assert.equal(p.discountLimit({...employee,permission_overrides:{}}),5);
assert.equal(p.can({...employee,role:'manager',permission_overrides:{'inventory.adjust':'deny'}},'inventory.adjust'),false);
console.log('PASS: individual deny/approval overrides take precedence over discount limits and manager permissions');
