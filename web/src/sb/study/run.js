// The study job runner. It lives at module level (not in a component), so a translation keeps going while the
// student opens other tabs, and the result is still there when they come back.
import { useSyncExternalStore } from 'react';
import { getSession, onSessionChange, postStream } from '../client';
import { b } from '../bi';
import { FileError, LIMITS, planChunks, releaseSource, textSource } from './files';
import { groupFormats, normalizeStudy, translationText } from './data';

const HISTORY_SLOT = 'ashur-bio-study-history';
const HISTORY_MAX = 8;
// The free Gemini tier is shared by the whole department (about 10–15 requests a minute), so one part at a time.
const CONCURRENCY = 1;
// A student's daily allowance (AI_USER_DAILY in the study-ai function); a bigger job could never finish today.
export const MAX_PARTS = 20;
// How long to keep waiting out a busy free tier for one part before giving up on it.
const MAX_BUSY_WAITS = 12;

const NET = b('انقطع الاتصال أثناء المعالجة.', 'The connection dropped while processing.');
const SERVER = b('صار خطأ بالخادم.', 'Server error.');
const BAD_JSON = b('النتيجة وصلت ناقصة.', 'The result arrived incomplete.');
const BUSY = b('خدمة Gemini المجانية مزدحمة جداً هسه. جرّب بعد شوية.', 'The free Gemini service is very busy right now. Try again shortly.');
// Nothing more will work today (or at all) after these, so the whole job stops with the message.
const STOP_CODES = new Set(['not_configured', 'user_limit', 'global_limit', 'daily_quota', 'unauthorized']);

const bi = (j, fallback) => (j && typeof j.message === 'string' ? b(j.message, j.message_en || j.message) : fallback);
let seq = 0;
const uid = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

/* ---------------- store ---------------- */

// Per account, so a shared phone never shows one student's files to the next.
let owner = getSession()?.user_id || '';
const slot = () => `${HISTORY_SLOT}:${owner}`;

function loadHistory() {
  if (!owner) return [];
  try {
    const v = JSON.parse(localStorage.getItem(slot()) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

let state = { source: null, range: null, job: null, history: loadHistory(), v: 0 };
const subs = new Set();
const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function emit() {
  state = { ...state, v: state.v + 1 };
  subs.forEach((fn) => fn());
}
let timer = 0;
function emitSoon() {
  if (timer) return;
  timer = setTimeout(() => { timer = 0; emit(); }, 90);
}

// Signing out (or in as someone else) drops the open file, stops any job and switches the history.
onSessionChange((sess) => {
  const id = sess?.user_id || '';
  if (id === owner) return; // token refresh
  owner = id;
  if (state.job?.status === 'running') { state.job.status = 'stopped'; state.job.ctrl.abort(); }
  releaseSource(state.source);
  state = { source: null, range: null, job: null, history: loadHistory(), v: state.v };
  emit();
});

export const useStudy = () => useSyncExternalStore(subscribe, () => state);
export const getStudy = () => state;

export function setSource(src) {
  if (state.source && state.source !== src && !(src?.kind === 'images' && state.source.kind === 'images')) releaseSource(state.source);
  // A new PDF starts with all its pages selected (up to the per-request page limit).
  const range = src?.kind === 'pdf' ? (src === state.source ? state.range : { from: 1, to: Math.min(src.pages, LIMITS.pages) }) : null;
  state = { ...state, source: src, range };
  emit();
}

// Kept here, not in the screen, so the chosen pages survive switching tabs.
export function setRange(range) {
  state = { ...state, range };
  emit();
}

/* ---------------- history (finished results, kept on this device) ---------------- */

function saveHistory(job) {
  if (!owner) return;
  const done = job.parts.filter((p) => p.status === 'done');
  if (!done.length) return;
  const entry = {
    id: job.id, createdAt: job.createdAt, name: job.name, task: job.task, options: job.options,
    complete: done.length === job.parts.length,
    parts: done.map((p) => ({ id: p.id, label: p.label, numbering: p.numbering, formats: p.formats, status: 'done', text: p.text, data: p.data })),
  };
  let list = [entry, ...state.history.filter((h) => h.id !== job.id)].slice(0, HISTORY_MAX);
  // localStorage holds ~5 MB: drop the oldest results until the new one fits. If it can't fit even alone,
  // keep the saved list as it is (the result stays on screen, it just isn't remembered).
  for (;;) {
    try { localStorage.setItem(slot(), JSON.stringify(list)); state = { ...state, history: list }; return; } catch { /* over quota */ }
    if (list.length <= 1) return;
    list = list.slice(0, -1);
  }
}

export function deleteHistory(id) {
  const list = state.history.filter((h) => h.id !== id);
  try { localStorage.setItem(slot(), JSON.stringify(list)); } catch { /* ignore */ }
  state = { ...state, history: list, job: state.job?.id === id && state.job.status !== 'running' ? null : state.job };
  emit();
}

export function openHistory(id) {
  const h = state.history.find((x) => x.id === id);
  if (!h || state.job?.status === 'running') return;
  state = { ...state, job: { ...h, status: 'done', fromHistory: true, parts: h.parts.map((p) => ({ ...p })) } };
  emit();
}

export function closeJob() {
  if (state.job?.status === 'running') return;
  state = { ...state, job: null };
  emit();
}

// "Summarise this translation": a finished translation becomes a text source for the study task.
export function sourceFromTranslation(job) {
  const text = translationText(job);
  const [ar, en] = String(job.name).split('\n');
  setSource(textSource(en ? b(`${ar} (الترجمة)`, `${en} (translation)`) : `${ar} (الترجمة)`, text));
}

/* ---------------- running ---------------- */

function mkPart(chunk, formats) {
  return {
    id: uid(), chunk, formats, label: chunk.label, numbering: chunk.numbering,
    status: 'queued', phase: '', text: '', data: null, error: '', tries: 0,
  };
}

// Throws FileError with a message for the student when the plan is too big.
export function planJob(source, options) {
  const chunks = planChunks(source, options);
  const groups = options.task === 'study' ? groupFormats(options.formats, options.depth) : [null];
  const parts = [];
  chunks.forEach((c) => groups.forEach((g) => parts.push(mkPart(c, g))));
  return parts;
}

export const tooBigMsg = (n) => b(
  `هذا الطلب يحتاج ${n} جزء، وحصتك اليومية ${MAX_PARTS} جزء. اختار صفحات أقل أو أنواع أقل.`,
  `This needs ${n} parts and your daily allowance is ${MAX_PARTS}. Choose fewer pages or fewer types.`,
);

export function startJob(options) {
  const src = state.source;
  if (!src || state.job?.status === 'running') return;
  const parts = planJob(src, options);
  if (parts.length > MAX_PARTS) {
    throw new FileError(tooBigMsg(parts.length));
  }
  const job = {
    id: uid(), createdAt: new Date().toISOString(), name: src.name, task: options.task, options,
    parts, status: 'running', error: '', ctrl: new AbortController(), src, pauseUntil: 0,
  };
  state = { ...state, job };
  emit();
  pump(job);
}

export function stopJob() {
  const job = state.job;
  if (!job || job.status !== 'running') return;
  job.status = 'stopped';
  job.ctrl.abort();
  job.parts.forEach((p) => { if (p.status === 'queued' || p.status === 'running') { p.status = 'stopped'; p.phase = ''; p.text = ''; } });
  saveHistory(job);
  emit();
}

// Continue a stopped job, or retry failed parts. Only possible while the file is still open on this page.
export function resumeJob() {
  const job = state.job;
  if (!job || job.status === 'running' || job.fromHistory) return;
  let any = false;
  job.parts.forEach((p) => { if (p.status === 'stopped' || p.status === 'failed') { p.status = 'queued'; p.tries = 0; p.wait = 0; p.error = ''; p.text = ''; any = true; } });
  if (!any) return;
  job.status = 'running';
  job.error = '';
  job.pauseUntil = 0;
  job.ctrl = new AbortController();
  emit();
  pump(job);
}

function pump(job) {
  if (job.status !== 'running' || state.job !== job) return;
  // The service asked us to slow down: start nothing until the pause is over.
  if (job.pauseUntil > Date.now()) {
    clearTimeout(job.pauseTimer);
    job.pauseTimer = setTimeout(() => pump(job), job.pauseUntil - Date.now() + 50);
    return;
  }
  let active = job.parts.filter((p) => p.status === 'running').length;
  for (const p of job.parts) {
    if (active >= CONCURRENCY) break;
    if (p.status !== 'queued' || p.wait > Date.now()) continue;
    p.status = 'running';
    p.run = (p.run || 0) + 1;
    active++;
    const run = p.run;
    const signal = job.ctrl.signal;
    runPart(job, p, run, signal)
      .catch(() => { if (!signal.aborted && p.run === run) fail(p, SERVER); })
      .finally(() => { emit(); pump(job); });
  }
  if (active === 0) {
    const waiting = job.parts.filter((p) => p.status === 'queued');
    if (waiting.length) {
      setTimeout(() => pump(job), Math.max(200, Math.min(...waiting.map((p) => (p.wait || 0) - Date.now()))));
      return;
    }
    job.status = 'done';
    saveHistory(job);
    emit();
  }
}

function fail(part, msg) {
  part.status = 'failed';
  part.phase = '';
  part.error = msg;
  part.text = '';
}

// Busy service, dropped connection, cut-off result: try the same part again after a short wait (twice at most).
function transient(part, msg) {
  part.tries += 1;
  if (part.tries > 2) { fail(part, msg); return; }
  part.status = 'queued';
  part.phase = '';
  part.text = '';
  part.wait = Date.now() + (part.tries === 1 ? 2500 : 8000);
}

// 429 from the free tier (or our department-wide pacing): wait the time the server asked for, then retry the
// same part. These waits don't count as failures; the whole job pauses so no other part jumps the queue.
function busy(job, part, seconds, msg) {
  part.waits = (part.waits || 0) + 1;
  if (part.waits > MAX_BUSY_WAITS) { fail(part, msg || BUSY); return; }
  const s = Math.min(90, Math.max(3, Number(seconds) || 15)) + Math.random() * 3; // jitter: students don't retry in lockstep
  part.status = 'queued';
  part.phase = '';
  part.text = '';
  job.pauseUntil = Date.now() + s * 1000;
}

// Study answers should be pure JSON (the request asks for it), but tolerate a stray code fence or preface.
function parseJson(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf('{');
  const z = t.lastIndexOf('}');
  if (a < 0 || z <= a) throw new Error('not json');
  return JSON.parse(t.slice(a, z + 1));
}

// A part that was too long becomes two smaller ones (fewer pages, or fewer question types).
function splitPart(job, part) {
  let halves = part.chunk?.split?.();
  if (halves) halves = halves.map((c) => mkPart(c, part.formats));
  else if (part.formats && part.formats.length > 1) {
    const mid = Math.ceil(part.formats.length / 2);
    halves = [mkPart(part.chunk, part.formats.slice(0, mid)), mkPart(part.chunk, part.formats.slice(mid))];
  }
  if (!halves) return false;
  const i = job.parts.indexOf(part);
  if (i >= 0) job.parts.splice(i, 1, ...halves);
  return true;
}

function halt(job, msg) {
  job.status = 'halted';
  job.error = msg;
  job.ctrl.abort();
  job.parts.forEach((p) => { if (p.status === 'queued' || p.status === 'running') { p.status = 'stopped'; p.phase = ''; p.text = ''; } });
  saveHistory(job);
}

// `run` and `signal` identify this attempt. After Stop/Continue or a retry, an older attempt that is still
// waiting (reading the PDF, uploading) must not write into the part any more.
async function runPart(job, part, run, signal) {
  const stale = () => signal.aborted || part.run !== run || job.status !== 'running';
  part.phase = 'reading';
  part.text = '';
  part.error = '';
  emitSoon();
  const o = job.options;
  let loaded;
  try {
    loaded = await part.chunk.load();
  } catch (e) {
    if (!stale()) fail(part, e instanceof FileError ? e.message : b('ما كدرنا نجهّز هذا الجزء من الملف.', 'We couldn\'t prepare this part of the file.'));
    return;
  }
  if (stale()) return;
  if (loaded.split) {
    if (!splitPart(job, part)) fail(part, SERVER);
    return;
  }
  const c = part.chunk;
  const body = JSON.stringify({
    task: job.task, target: o.target, keepTerms: o.keepTerms, formats: part.formats || undefined, depth: o.depth, lang: o.lang,
    numbering: c.numbering, start: c.start, count: c.count, total: c.total, pieces: loaded.pieces,
  });
  loaded = null;
  part.phase = 'sending';
  emitSoon();

  let res;
  try {
    res = await postStream('study-ai', body, signal);
  } catch (e) {
    if (stale()) return;
    if (e?.code === 'session_expired') { halt(job, e.message); return; }
    transient(part, e?.message || NET);
    return;
  }
  if (stale()) { res.body?.cancel().catch(() => {}); return; }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    if (stale()) return;
    const msg = bi(j, SERVER);
    const code = j?.error || '';
    if (STOP_CODES.has(code) || res.status === 401) { halt(job, msg); return; }
    if (code === 'too_large' || res.status === 413) { if (!splitPart(job, part)) fail(part, msg); return; }
    if (code === 'busy') { busy(job, part, j?.retry_after, msg); return; }
    if (res.status === 429 || res.status >= 500) { transient(part, msg); return; }
    fail(part, msg);
    return;
  }

  let end = null;
  try {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (stale()) { reader.cancel().catch(() => {}); return; }
        // Study answers are JSON and only shown when complete, so their deltas don't need a re-render.
        if (ev.type === 'delta') { part.text += ev.text; if (part.phase !== 'writing' || job.task === 'translate') { part.phase = 'writing'; emitSoon(); } }
        else if (ev.type === 'status') { part.phase = ev.phase; emitSoon(); }
        else if (ev.type === 'done' || ev.type === 'error') end = ev;
      }
    }
  } catch { /* connection dropped: handled below as "no end event" */ }
  if (stale()) return;
  if (!end) { transient(part, NET); return; }
  if (end.type === 'error') {
    const msg = bi(end, SERVER);
    if (end.code === 'too_long') {
      if (!splitPart(job, part)) fail(part, b('هذا الجزء طويل جداً حتى بعد التقسيم.', 'This part is too long even after splitting.'));
      return;
    }
    if (end.code === 'busy') { busy(job, part, end.retry_after, msg); return; }
    if (end.code === 'server') { transient(part, msg); return; }
    if (STOP_CODES.has(end.code)) { halt(job, msg); return; }
    fail(part, msg); // refused, bad_input
    return;
  }
  if (job.task === 'study') {
    let parsed;
    try { parsed = parseJson(part.text); } catch { transient(part, BAD_JSON); return; }
    part.data = normalizeStudy(parsed, part.formats);
    part.text = '';
  }
  part.status = 'done';
  part.phase = '';
}
