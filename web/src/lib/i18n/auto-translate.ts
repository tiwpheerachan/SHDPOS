// แปลข้อความไทยที่เหลือบนหน้าจอด้วยโมเดลแปลภาษา "ในเครื่อง" ของเบราว์เซอร์ (Chrome Translator API · on-device)
//   • ไม่ส่งข้อความออกนอกเครื่อง · ใช้เมื่อเปิดสวิตช์ และภาษาที่เลือกไม่ใช่ไทย
//   • แปลเฉพาะข้อความที่ยังเป็นไทย (ข้อความที่ระบบแปลไว้แล้วไม่แตะ) — ข้อความจากเซิร์ฟเวอร์/AI/ข้อความที่ตกหล่น
//   • ไม่แตะ: องค์ประกอบที่มี translate="no" / .notranslate / data-no-translate / ฟอนต์ mono (SKU, SN, เลขเอกสาร) / ช่องกรอก / โค้ด / iframe
//   • คำเฉพาะ (SKU, รหัส, ตัวเลข, อีเมล, คำอังกฤษ) ต้องอยู่ครบในผลแปล — ถ้าหายไป แปลแยกเฉพาะส่วนภาษาไทยแทน
//   • จำผลแปลในเครื่อง (localStorage) · กลับเป็นไทย/ปิดสวิตช์ = คืนข้อความเดิมทันที
import { useSyncExternalStore } from "react";

type Target = "en" | "zh";
export type AutoTrStatus = "off" | "unsupported" | "unavailable" | "downloadable" | "downloading" | "ready" | "error";
type State = { enabled: boolean; status: AutoTrStatus; progress: number; translated: number; message?: string };

const KEY = "shdpos.autotr";
const CACHE_VER = "v2";
const THAI = /[฀-๿]/;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE", "PRE", "IFRAME", "SVG", "NOSCRIPT", "KBD"]);
const ATTRS = ["placeholder", "title", "aria-label"] as const;
// คำเฉพาะที่ต้องคงไว้: รหัส/SKU/เลขเอกสาร/ตัวเลข/อีเมล/คำละติน
const PROTECT = /[A-Za-z0-9][A-Za-z0-9\-_.\/#:@+]*|\S+@\S+/g;

// คำที่ต้องแปลแบบตายตัว (แม่นกว่าเครื่องแปล) — ใช้เมื่อข้อความทั้งก้อนตรงกัน
const GLOSSARY: Record<string, { en: string; zh: string }> = {
  "บิล": { en: "Bill", zh: "单据" }, "ใบเสร็จ": { en: "Receipt", zh: "小票" }, "สาขา": { en: "Branch", zh: "门店" },
  "กะ": { en: "Shift", zh: "班次" }, "แต้ม": { en: "Points", zh: "积分" }, "สต๊อก": { en: "Stock", zh: "库存" },
  "โอนย้าย": { en: "Transfer", zh: "调拨" }, "รับคืน": { en: "Return", zh: "退货" }, "ใบลดหนี้": { en: "Credit note", zh: "红字发票" },
  "ใบกำกับภาษี": { en: "Tax invoice", zh: "增值税发票" }, "คลังกลาง": { en: "Central warehouse", zh: "中央仓" },
  "พักตรวจ": { en: "Quarantine", zh: "待检" }, "เงินสด": { en: "Cash", zh: "现金" }, "พร้อมเพย์": { en: "PromptPay", zh: "PromptPay" },
};

// แก้คำที่เครื่องแปลมักแปลผิดบริบทร้านค้า (ทับหลังแปล)
const POSTFIX: Record<Target, [RegExp, string][]> = {
  zh: [[/法案/g, "单据"], [/账单/g, "单据"], [/分行/g, "门店"], [/分支/g, "门店"], [/审查/g, "审核"], [/转移/g, "调拨"], [/换档|移位/g, "班次"], [/点数/g, "积分"], [/中央系统/g, "中台系统"]],
  en: [[/\bbranch office\b/gi, "branch"], [/\bshift work\b/gi, "shift"], [/\bscore(s)?\b/gi, "point$1"]],
};
const postfix = (t: Target, s: string) => POSTFIX[t].reduce((acc, [re, to]) => acc.replace(re, to), s);

let state: State = { enabled: false, status: "off", progress: 0, translated: 0 };
const subs = new Set<() => void>();
const emit = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export function useAutoTranslate(): State { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => state, () => state); }

// ── Translator API (Chrome 138+) ──
type TranslatorLike = { translate: (s: string) => Promise<string> };
type TranslatorCtor = {
  availability: (o: { sourceLanguage: string; targetLanguage: string }) => Promise<string>;
  create: (o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }) => Promise<TranslatorLike>;
};
const api = (): TranslatorCtor | null => (typeof self !== "undefined" && "Translator" in self ? (self as unknown as { Translator: TranslatorCtor }).Translator : null);
const translators: Partial<Record<Target, TranslatorLike>> = {};

export function autoTranslateSupported(): boolean { return !!api(); }

async function getTranslator(t: Target, userGesture: boolean): Promise<TranslatorLike | null> {
  if (translators[t]) return translators[t]!;
  const A = api();
  if (!A) { emit({ status: "unsupported" }); return null; }
  const opts = { sourceLanguage: "th", targetLanguage: t };
  const av = await A.availability(opts).catch(() => "unavailable");
  if (av === "unavailable") { emit({ status: "unavailable" }); return null; }
  // ต้องดาวน์โหลดโมเดลครั้งแรก → ต้องเริ่มจากการกดของผู้ใช้
  if ((av === "downloadable" || av === "downloading") && !userGesture) { emit({ status: "downloadable" }); return null; }
  try {
    emit({ status: av === "available" ? "ready" : "downloading", progress: 0 });
    const tr = await A.create({ ...opts, monitor: (m) => m.addEventListener("downloadprogress", (e) => emit({ progress: Math.round(((e as unknown as { loaded: number }).loaded ?? 0) * 100) })) });
    translators[t] = tr; emit({ status: "ready", progress: 100 });
    return tr;
  } catch (e) { emit({ status: "error", message: e instanceof Error ? e.message : String(e) }); return null; }
}

// ── แคชผลแปล ──
const cache: Record<Target, Map<string, string>> = { en: new Map(), zh: new Map() };
function loadCache(t: Target) {
  if (cache[t].size) return;
  try { const raw = localStorage.getItem(`${KEY}.cache.${CACHE_VER}.${t}`); if (raw) for (const [k, v] of JSON.parse(raw) as [string, string][]) cache[t].set(k, v); } catch { /* */ }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveCache(t: Target) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(`${KEY}.cache.${CACHE_VER}.${t}`, JSON.stringify([...cache[t]].slice(-3000))); } catch { /* เต็ม/โหมดส่วนตัว */ }
  }, 1500);
}

/** แปล 1 ข้อความ โดยคงคำเฉพาะไว้ */
async function translateText(tr: TranslatorLike, t: Target, src: string): Promise<string> {
  const key = src.trim();
  const g = GLOSSARY[key];
  if (g) return src.replace(key, g[t]);
  const hit = cache[t].get(key);
  if (hit !== undefined) return src.replace(key, hit);
  const tokens = key.match(PROTECT) ?? [];
  let out = await tr.translate(key);
  // คำเฉพาะหายไปจากผลแปล → แปลเฉพาะช่วงภาษาไทยทีละช่วง คงส่วนอื่นไว้ตรงตัว
  if (tokens.some((tok) => !out.includes(tok))) {
    const parts = key.split(/([A-Za-z0-9][A-Za-z0-9\-_.\/#:@+]*|\S+@\S+)/);
    const done = await Promise.all(parts.map((p) => (THAI.test(p) ? tr.translate(p.trim()).then((x) => (p.startsWith(" ") ? " " : "") + x + (p.endsWith(" ") ? " " : "")) : Promise.resolve(p))));
    out = done.join("");
  }
  out = postfix(t, out);
  cache[t].set(key, out); saveCache(t);
  return src.replace(key, out);
}

// ── เดินหน้าจอ ──
type Rec = { orig: string; applied: string };
const textRecs = new WeakMap<Text, Rec>();
const attrRecs = new WeakMap<Element, Record<string, Rec>>();
const touched = new Set<WeakRef<Node>>();

// ช่องกรอก: แปล placeholder/title ได้ (ไม่แตะค่าที่พิมพ์) → ตรวจข้ามจากตัวแม่แทนตัวมันเอง
const attrHost = (e: Element): Element | null => (e.tagName === "INPUT" || e.tagName === "TEXTAREA" ? e.parentElement : e);
function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP_TAGS.has(e.tagName.toUpperCase())) return true;
    if (e.getAttribute("translate") === "no" || e.classList.contains("notranslate") || e.hasAttribute("data-no-translate") || e.classList.contains("font-mono")) return true;
    if ((e as HTMLElement).isContentEditable) return true;
  }
  return false;
}

let target: Target | null = null;
let observer: MutationObserver | null = null;
let pending = new Set<Node>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function collect(root: Node, out: { texts: Text[]; attrs: [Element, string][] }) {
  if (root.nodeType === Node.TEXT_NODE) {
    const tn = root as Text;
    if (THAI.test(tn.data) && !skipped(tn.parentElement)) out.texts.push(tn);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  const el = root as Element;
  if (el.nodeType === Node.ELEMENT_NODE && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
    for (const a of ATTRS) { const v = el.getAttribute(a); if (v && THAI.test(v) && !skipped(attrHost(el))) out.attrs.push([el, a]); }
    return;
  }
  if (el.nodeType === Node.ELEMENT_NODE && skipped(el)) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n: Node | null = walker.currentNode; n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) { const tn = n as Text; if (THAI.test(tn.data) && !skipped(tn.parentElement)) out.texts.push(tn); }
    else {
      const e = n as Element;
      for (const a of ATTRS) { const v = e.getAttribute(a); if (v && THAI.test(v) && !skipped(attrHost(e))) out.attrs.push([e, a]); }
    }
  }
}

async function process(nodes: Node[]) {
  const t = target; if (!t) return;
  const tr = translators[t]; if (!tr) return;
  const out = { texts: [] as Text[], attrs: [] as [Element, string][] };
  nodes.forEach((n) => n.isConnected && collect(n, out));
  const jobs: Promise<void>[] = [];
  const limit = 4; let active = 0; const queue: (() => Promise<void>)[] = [];
  const run = (f: () => Promise<void>) => new Promise<void>((res) => { const go = async () => { active++; try { await f(); } finally { active--; res(); queue.shift()?.(); } }; if (active < limit) void go(); else queue.push(go); });
  for (const tn of out.texts) {
    const rec = textRecs.get(tn);
    if (rec && tn.data === rec.applied) continue;              // แปลแล้ว ยังไม่ถูกเปลี่ยน
    const orig = tn.data;                                      // ข้อความใหม่จาก React = ต้นฉบับใหม่
    jobs.push(run(async () => {
      const res = await translateText(tr, t, orig).catch(() => orig);
      if (target !== t || tn.data !== orig) return;            // ระหว่างแปลมีการเปลี่ยน → ข้าม
      textRecs.set(tn, { orig, applied: res }); touched.add(new WeakRef(tn));
      tn.data = res; emit({ translated: state.translated + 1 });
    }));
  }
  for (const [el, a] of out.attrs) {
    const recs = attrRecs.get(el) ?? {};
    const cur = el.getAttribute(a)!;
    if (recs[a] && recs[a].applied === cur) continue;
    jobs.push(run(async () => {
      const res = await translateText(tr, t, cur).catch(() => cur);
      if (target !== t || el.getAttribute(a) !== cur) return;
      recs[a] = { orig: cur, applied: res }; attrRecs.set(el, recs); touched.add(new WeakRef(el));
      el.setAttribute(a, res);
    }));
  }
  await Promise.all(jobs);
}

function schedule(n: Node) {
  pending.add(n);
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    if (running) { schedule(document.body); return; }
    const batch = [...pending]; pending = new Set();
    running = true;
    try { await process(batch); } finally { running = false; }
  }, 120);
}

function restoreAll() {
  for (const ref of touched) {
    const n = ref.deref(); if (!n) continue;
    if (n.nodeType === Node.TEXT_NODE) { const r = textRecs.get(n as Text); if (r && (n as Text).data === r.applied) (n as Text).data = r.orig; textRecs.delete(n as Text); }
    else { const el = n as Element; const recs = attrRecs.get(el); if (recs) for (const [a, r] of Object.entries(recs)) if (el.getAttribute(a) === r.applied) el.setAttribute(a, r.orig); attrRecs.delete(el); }
  }
  touched.clear();
}

function stop() {
  observer?.disconnect(); observer = null; target = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  pending = new Set(); restoreAll();
}

/** เรียกทุกครั้งที่ภาษา/สวิตช์เปลี่ยน — userGesture=true เมื่อมาจากการกดปุ่ม (อนุญาตดาวน์โหลดโมเดล) */
export async function syncAutoTranslate(locale: string, userGesture = false) {
  if (typeof window === "undefined") return;
  if (!api()) { emit({ status: "unsupported" }); stop(); return; }
  if (!state.enabled || locale === "th") { stop(); emit({ status: state.enabled ? "ready" : "off" }); return; }
  const t: Target = locale === "zh" ? "zh" : "en";
  if (target === t && observer) return;
  stop();
  loadCache(t);
  const tr = await getTranslator(t, userGesture);
  if (!tr || !state.enabled) return;
  target = t;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") schedule(m.target);
      else if (m.type === "attributes") schedule(m.target);
      else m.addedNodes.forEach((n) => schedule(n));
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  schedule(document.body);
}

export function initAutoTranslate() {
  try { emit({ enabled: localStorage.getItem(KEY) === "1", status: api() ? "off" : "unsupported" }); } catch { /* */ }
}
export async function setAutoTranslate(on: boolean, locale: string) {
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* */ }
  emit({ enabled: on, translated: 0 });
  await syncAutoTranslate(locale, true);
}
