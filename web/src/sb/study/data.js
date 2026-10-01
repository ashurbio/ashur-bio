// Study formats, validation of the model's JSON, merging parts, and plain-text export.
import { b, split } from '../bi';

export const FORMATS = ['summary', 'terms', 'mcq', 'true_false', 'lists', 'reasons', 'compare', 'blanks', 'essay'];

// w: rough output weight for one part at standard depth, used to keep each request well inside the time limit.
export const FORMAT_META = {
  summary: { label: b('الخلاصة والنقاط المهمة', 'Key points summary'), w: 3 },
  terms: { label: b('المصطلحات والتعاريف', 'Terms & definitions'), w: 1.5 },
  mcq: { label: b('اختيار من متعدد', 'Multiple choice (MCQ)'), w: 2 },
  true_false: { label: b('صح وخطأ', 'True or false'), w: 1 },
  lists: { label: b('عدّد (تعدادات)', 'List / enumerate'), w: 1.5 },
  reasons: { label: b('علّل', 'Give reasons'), w: 2 },
  compare: { label: b('قارن (الفروقات)', 'Compare'), w: 2 },
  blanks: { label: b('املأ الفراغ', 'Fill in the blank'), w: 1 },
  essay: { label: b('أسئلة مقالية (اشرح)', 'Essay questions'), w: 3 },
};

export const DEPTHS = [
  ['brief', b('مختصر', 'Brief')],
  ['standard', b('متوسط', 'Standard')],
  ['full', b('شامل', 'Comprehensive')],
];

const DEPTH_MULT = { brief: 0.6, standard: 1, full: 1.8 };
const GROUP_BUDGET = 7;

// Several formats share one request until their combined weight would make it too long.
export function groupFormats(formats, depth) {
  const m = DEPTH_MULT[depth] || 1;
  const groups = [];
  let cur = [];
  let w = 0;
  for (const f of FORMATS.filter((x) => formats.includes(x))) {
    const fw = FORMAT_META[f].w * m;
    if (cur.length && w + fw > GROUP_BUDGET) { groups.push(cur); cur = []; w = 0; }
    cur.push(f);
    w += fw;
  }
  if (cur.length) groups.push(cur);
  return groups;
}

const LETTERS = { ar: ['أ', 'ب', 'ج', 'د', 'هـ', 'و'], en: ['A', 'B', 'C', 'D', 'E', 'F'] };
export const letters = (lang) => (lang === 'ar' ? LETTERS.ar : LETTERS.en);

const s = (v) => (typeof v === 'string' ? v.trim() : '');
const strs = (v) => (Array.isArray(v) ? v.map(s).filter(Boolean) : []);
const pg = (v) => s(v).slice(0, 20);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Options that refer to other options can't be reordered.
const POSITIONAL = /(all|none|both)\b.*\b(above|these)|\bboth\b|كل ما سبق|جميع ما سبق|لا شيء مما سبق|ولا واحد|كلاهما|كلا الخيارين|^\s*[أبجدABCD]\s*و\s*[أبجدABCD]\s*$/i;

// Models favour some answer positions; shuffle (deterministically per question) so the key isn't guessable.
function shuffleMcq(q) {
  if (q.options.some((o) => POSITIONAL.test(o))) return q;
  const r = rng(hash(q.question));
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return { ...q, options: order.map((i) => q.options[i]), answer: order.indexOf(q.answer) };
}

const CLEAN = {
  summary: (x) => { const points = strs(x.points); return points.length ? { heading: s(x.heading), points, page: pg(x.page) } : null; },
  terms: (x) => (s(x.term) && s(x.definition) ? { term: s(x.term), definition: s(x.definition), page: pg(x.page) } : null),
  mcq: (x) => {
    const options = Array.isArray(x.options) ? x.options.map(s) : [];
    const answer = Number(x.answer);
    if (!s(x.question) || options.length < 2 || options.length > 6 || options.some((o) => !o)) return null;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    if (new Set(options).size !== options.length) return null;
    return shuffleMcq({ question: s(x.question), options, answer, explanation: s(x.explanation), page: pg(x.page) });
  },
  true_false: (x) => (s(x.statement) && typeof x.answer === 'boolean' ? { statement: s(x.statement), answer: x.answer, correction: s(x.correction), page: pg(x.page) } : null),
  lists: (x) => { const items = strs(x.items); return s(x.question) && items.length ? { question: s(x.question), items, page: pg(x.page) } : null; },
  reasons: (x) => (s(x.question) && s(x.answer) ? { question: s(x.question), answer: s(x.answer), page: pg(x.page) } : null),
  compare: (x) => {
    const rows = Array.isArray(x.rows) ? x.rows.map((r) => ({ aspect: s(r?.aspect), a: s(r?.a), b: s(r?.b) })).filter((r) => r.aspect && (r.a || r.b)) : [];
    return s(x.a) && s(x.b) && rows.length ? { title: s(x.title), a: s(x.a), b: s(x.b), rows, page: pg(x.page) } : null;
  },
  blanks: (x) => (s(x.sentence) && s(x.answer) ? { sentence: s(x.sentence), answer: s(x.answer), page: pg(x.page) } : null),
  essay: (x) => (s(x.question) && s(x.answer) ? { question: s(x.question), answer: s(x.answer), page: pg(x.page) } : null),
};

// Never trust model output blindly: drop anything malformed instead of showing a broken question.
export function normalizeStudy(raw, formats) {
  const out = { topic: s(raw?.topic), notes: strs(raw?.notes) };
  for (const f of formats) {
    out[f] = (Array.isArray(raw?.[f]) ? raw[f] : []).map((x) => (x && typeof x === 'object' ? CLEAN[f](x) : null)).filter(Boolean);
  }
  return out;
}

// All finished parts of a study job, merged per format in file order.
export function mergeStudy(parts) {
  const out = { topics: [], notes: [] };
  const seen = {};
  FORMATS.forEach((f) => { out[f] = []; seen[f] = new Set(); });
  for (const p of parts) {
    if (p.status !== 'done' || !p.data) continue;
    if (p.data.topic && !out.topics.includes(p.data.topic)) out.topics.push(p.data.topic);
    (p.data.notes || []).forEach((n) => out.notes.push({ text: n, label: p.label }));
    for (const f of FORMATS) {
      for (const item of p.data[f] || []) {
        // Neighbouring parts can repeat a fact; show each question once.
        const key = (item.question || item.statement || item.term || item.sentence || item.heading || '').toLowerCase();
        if (key && seen[f].has(key)) continue;
        if (key) seen[f].add(key);
        out[f].push({ ...item, numbering: p.numbering });
      }
    }
  }
  return out;
}

const UNIT = { page: ['ص', 'p.'], image: ['صورة', 'photo'], slide: ['شريحة', 'slide'], part: ['جزء', 'part'] };
export const pageLabel = (numbering, page) => (page ? b(`${UNIT[numbering]?.[0] || 'ص'} \u2066${page}\u2069`, `${UNIT[numbering]?.[1] || 'p.'} ${page}`) : '');

/* ------------------------------------------------------------------ plain-text export */

const plain = (t) => String(t || '').replace(/\*\*(.+?)\*\*/g, '$1');
const ref = (it) => (it.page ? `  (${split(pageLabel(it.numbering, it.page))[0]})` : '');

export function translationText(job) {
  return job.parts.filter((p) => p.status === 'done').map((p) => p.text.trim()).join('\n\n');
}

export function studyText(job) {
  const m = mergeStudy(job.parts);
  const L = letters(job.options.lang);
  const lines = [];
  const head = (f) => { lines.push('', `==== ${split(FORMAT_META[f].label)[0]} ====`, ''); };
  for (const f of FORMATS) {
    const list = m[f];
    if (!list?.length) continue;
    head(f);
    list.forEach((it, i) => {
      const n = `${i + 1}. `;
      switch (f) {
        case 'summary':
          lines.push(`■ ${plain(it.heading) || '—'}${ref(it)}`);
          it.points.forEach((p) => lines.push(`  • ${plain(p)}`));
          lines.push('');
          break;
        case 'terms': lines.push(`${n}${plain(it.term)}: ${plain(it.definition)}${ref(it)}`); break;
        case 'mcq':
          lines.push(`${n}${plain(it.question)}${ref(it)}`);
          it.options.forEach((o, k) => lines.push(`   ${L[k]}) ${plain(o)}`));
          lines.push(`   ✔ ${L[it.answer]}) ${plain(it.options[it.answer])}${it.explanation ? ` — ${plain(it.explanation)}` : ''}`, '');
          break;
        case 'true_false':
          lines.push(`${n}${plain(it.statement)}${ref(it)}`, `   ✔ ${it.answer ? 'صح (True)' : 'خطأ (False)'}${it.correction ? ` — ${plain(it.correction)}` : ''}`, '');
          break;
        case 'lists':
          lines.push(`${n}${plain(it.question)}${ref(it)}`);
          it.items.forEach((x, k) => lines.push(`   ${k + 1}) ${plain(x)}`));
          lines.push('');
          break;
        case 'compare':
          lines.push(`${n}${plain(it.title) || `${it.a} / ${it.b}`}${ref(it)}`);
          it.rows.forEach((r) => lines.push(`   - ${plain(r.aspect)}: ${plain(it.a)}: ${plain(r.a)} | ${plain(it.b)}: ${plain(r.b)}`));
          lines.push('');
          break;
        case 'blanks': lines.push(`${n}${plain(it.sentence)}${ref(it)}`, `   ✔ ${plain(it.answer)}`, ''); break;
        default: lines.push(`${n}${plain(it.question)}${ref(it)}`, `   ✔ ${plain(it.answer)}`, '');
      }
    });
  }
  if (m.notes.length) {
    lines.push('', '==== ملاحظات ====', '');
    m.notes.forEach((x) => lines.push(`- ${split(x.label)[0]}: ${x.text}`));
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
