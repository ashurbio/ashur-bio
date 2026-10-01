// The study job runner. It lives at module level (not in a component), so a translation keeps going while the
// student opens other tabs, and the result is still there when they come back.
import { useSyncExternalStore } from 'react';
import { getSession, onSessionChange, postStream } from '../client';
import { b } from '../bi';
import { FileError, LIMITS, planChunks, releaseSource, textSource } from './files';
import { groupFormats, normalizeStudy, translationText } from './data';

const HISTORY_SLOT = 'ashur-bio-study-history';
const HISTORY_MAX = 8;
const CONCURRENCY = 3;
export const MAX_PARTS = 80;

const NET = b('انقطع الاتصال أثناء المعالجة.', 'The connection dropped while processing.');
const SERVER = b('صار خطأ بالخادم.', 'Server error.');
const BAD_JSON = b('النتيجة وصلت ناقصة.', 'The result arrived incomplete.');
const STOP_CODES = new Set(['not_configured', 'user_limit', 'global_limit', 'unauthorized']);

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

export function startJob(options) {
  const src = state.source;
  if (!src || state.job?.status === 'running') return;
  const parts = planJob(src, options);
  if (parts.length > MAX_PARTS) {
    throw new FileError(b(`الطلب كبير (${parts.length} جزء). اختار صفحات أقل أو أنواع أسئلة أقل.`, `This request is too big (${parts.length} parts). Choose fewer pages or fewer question types.`));
  }
  const job = {
    id: uid(), createdAt: new Date().toISOString(), name: src.name, task: options.task, options,
    parts, status: 'running', error: '', ctrl: new AbortController(), src,
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
  job.ctrl = new AbortController();
  emit();
  pump(job);
}

function pump(job) {
  if (job.status !== 'running' || state.job !== job) return;
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
    if (end.code === 'busy' || end.code === 'server') { transient(part, msg); return; }
    if (STOP_CODES.has(end.code)) { halt(job, msg); return; }
    fail(part, msg); // refused, bad_input
    return;
  }
  if (job.task === 'study') {
    let parsed;
    try { parsed = JSON.parse(part.text); } catch { transient(part, BAD_JSON); return; }
    part.data = normalizeStudy(parsed, part.formats);
    part.text = '';
  }
  part.status = 'done';
  part.phase = '';
}
