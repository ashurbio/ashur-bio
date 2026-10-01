// "Translate & summarise" screen: pick a handout (PDF, photos, Word, PowerPoint, text), translate it,
// or turn it into a summary and exam-style questions (MCQ, true/false, list, give reasons, compare …).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileUp, Camera, ClipboardPaste, Languages, ListChecks, X, Copy, Download, Printer, Square, RotateCcw, Trash2,
  History, FileText, Images, Presentation, Sparkles, Plus,
} from 'lucide-react';
import { useStore } from '../store';
import { b, Bi, flat, split } from '../bi';
import { agoBi, lsGet, lsSet } from '../util';
import { FileError, LIMITS, iso, readFiles, removeImage, textSource } from './files';
import {
  useStudy, setSource, setRange, startJob, stopJob, resumeJob, openHistory, deleteHistory, closeJob, sourceFromTranslation, planJob, MAX_PARTS, tooBigMsg,
} from './run';
import { FORMATS, FORMAT_META, DEPTHS, studyText, translationText } from './data';
import { Markdown } from './md';
import { StudyResults } from './results';

const OPTS_SLOT = 'ashur-bio-study-options';
const DEFAULTS = { task: 'translate', target: 'ar', keepTerms: true, formats: ['summary', 'mcq', 'true_false'], depth: 'standard', lang: 'ar' };
const TASK_LABEL = { translate: b('ترجمة', 'Translation'), study: b('تلخيص وأسئلة', 'Summary & questions') };
const PHASE = {
  reading: b('يجهّز الملف…', 'Preparing the file…'),
  sending: b('يرسل الجزء…', 'Sending…'),
  thinking: b('يقرأ ويحلّل…', 'Reading and analysing…'),
  writing: b('يكتب…', 'Writing…'),
};

function Chips({ label, options, value, onChange, multi = false }) {
  const on = (v) => (multi ? value.includes(v) : value === v);
  const toggle = (v) => (multi ? onChange(on(v) ? value.filter((x) => x !== v) : [...value, v]) : onChange(v));
  return (
    <div className="chips" role="group" aria-label={flat(label)}>
      {options.map(([v, l, Icon]) => (
        <button key={v} type="button" className="fchip" aria-pressed={on(v)} onClick={() => toggle(v)}>
          {Icon ? <Icon size={16} aria-hidden="true" /> : null}<Bi t={l} />
        </button>
      ))}
    </div>
  );
}

function OptLabel({ children }) {
  return <div className="opt-label"><Bi t={children} /></div>;
}

// Join bilingual strings into one: "a · b" in Arabic over "a · b" in English (plain strings count for both).
function joinBi(...parts) {
  const ps = parts.filter(Boolean).map((p) => split(p));
  return b(ps.map(([a]) => a).join(' · '), ps.map(([a, e]) => e || a).join(' · '));
}

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ---------------- step 1: the file ---------------- */

function Picker({ busy, onFiles, onText }) {
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState('');
  const pick = (e) => { onFiles(e.target.files); e.target.value = ''; };
  return (
    <>
      <div
        className={`drop${drag ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
      >
        <FileUp size={30} aria-hidden="true" className="drop-ico" />
        <p className="drop-t"><Bi t={b('ارفع الملزمة أو صوّرها', 'Upload the handout or photograph it')} /></p>
        <p className="hint"><Bi t={b('ملف PDF، صور، ملفات Word و PowerPoint، أو نص. وتكدر تسحب الملف هنا.', 'PDF, photos, Word and PowerPoint files, or text. You can also drop the file here.')} /></p>
        <div className="row drop-btns">
          <button className="btn" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><FileUp size={17} aria-hidden="true" /><Bi t={b('اختر ملف', 'Choose a file')} /></button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => camRef.current?.click()}><Camera size={17} aria-hidden="true" /><Bi t={b('صوّر بالكاميرا', 'Use the camera')} /></button>
          <button className="btn ghost" type="button" disabled={busy} aria-expanded={paste} onClick={() => setPaste(!paste)}><ClipboardPaste size={17} aria-hidden="true" /><Bi t={b('الصق نص', 'Paste text')} /></button>
        </div>
        <input ref={fileRef} type="file" hidden multiple accept=".pdf,.docx,.pptx,.txt,.md,image/*" onChange={pick} data-testid="study-file" />
        <input ref={camRef} type="file" hidden multiple accept="image/*" capture="environment" onChange={pick} />
      </div>
      {paste ? (
        <div className="field paste">
          <label htmlFor="study-paste"><Bi t={b('النص', 'Text')} /></label>
          <textarea id="study-paste" value={text} dir="auto" maxLength={LIMITS.textChars} onChange={(e) => setText(e.target.value)} placeholder="الصق نص المحاضرة هنا… / Paste the lecture text here…" />
          <div className="row"><button className="btn sm" type="button" disabled={!text.trim()} onClick={() => onText(text)}><Bi t={b('استخدم هذا النص', 'Use this text')} /></button></div>
        </div>
      ) : null}
    </>
  );
}

function SourceCard({ source, range, setRange, onAddPhotos, onRemoveImage, onClear, locked }) {
  const addRef = useRef(null);
  const Icon = source.kind === 'images' ? Images : source.kind === 'slides' ? Presentation : FileText;
  let meta;
  if (source.kind === 'pdf') meta = b(`${iso('PDF')} · ${source.pages} صفحة · ${iso(kb(source.size))}`, `PDF · ${source.pages} pages · ${kb(source.size)}`);
  else if (source.kind === 'images') meta = b(`${source.items.length} صورة`, `${source.items.length} photos`);
  else if (source.kind === 'slides') meta = b(`${iso('PowerPoint')} · ${source.total} شريحة`, `PowerPoint · ${source.total} slides`);
  else meta = b(`نص · ${source.text.length.toLocaleString('en')} حرف`, `Text · ${source.text.length.toLocaleString('en')} characters`);
  const pages = source.kind === 'pdf' ? range.to - range.from + 1 : 0;
  return (
    <>
      <div className="src">
        <span className="src-ico" aria-hidden="true"><Icon size={22} /></span>
        <div className="min0">
          <div className="t" dir="auto"><Bi t={source.name} /></div>
          <div className="m"><Bi t={meta} /></div>
        </div>
        <button className="icon-btn" type="button" disabled={locked} onClick={onClear} aria-label="إزالة الملف / Remove file"><X size={18} /></button>
      </div>
      {source.kind === 'pdf' && source.pages > 1 ? (
        <div className="range">
          <div className="field half">
            <label htmlFor="pg-from"><Bi t={b('من صفحة', 'From page')} /></label>
            <input id="pg-from" type="number" inputMode="numeric" min={1} max={source.pages} value={range.from} disabled={locked}
              onChange={(e) => setRange({ ...range, from: Math.max(1, Math.min(source.pages, Number(e.target.value) || 1)) })} />
          </div>
          <div className="field half">
            <label htmlFor="pg-to"><Bi t={b('إلى صفحة', 'To page')} /></label>
            <input id="pg-to" type="number" inputMode="numeric" min={1} max={source.pages} value={range.to} disabled={locked}
              onChange={(e) => setRange({ ...range, to: Math.max(1, Math.min(source.pages, Number(e.target.value) || source.pages)) })} />
          </div>
          {pages > LIMITS.pages ? <p className="form-err" role="alert"><Bi t={b(`اختار ${LIMITS.pages} صفحة أو أقل بالمرة الوحدة.`, `Choose ${LIMITS.pages} pages or fewer at a time.`)} /></p> : null}
          {range.from > range.to ? <p className="form-err" role="alert"><Bi t={b('صفحة البداية لازم تكون قبل صفحة النهاية.', 'The first page must come before the last page.')} /></p> : null}
        </div>
      ) : null}
      {source.kind === 'images' ? (
        <div className="thumbs">
          {source.items.map((it, i) => (
            <figure key={it.url} className="thumb">
              <img src={it.url} alt={`صورة ${i + 1} / Photo ${i + 1}`} loading="lazy" />
              <figcaption className="num">{i + 1}</figcaption>
              <button type="button" className="thumb-x" disabled={locked} onClick={() => onRemoveImage(i)} aria-label={`حذف الصورة ${i + 1} / Remove photo ${i + 1}`}><X size={14} /></button>
            </figure>
          ))}
          <button type="button" className="thumb add" disabled={locked} onClick={() => addRef.current?.click()} aria-label="إضافة صور / Add photos"><Plus size={22} aria-hidden="true" /></button>
          <input ref={addRef} type="file" hidden multiple accept="image/*" onChange={(e) => { onAddPhotos(e.target.files); e.target.value = ''; }} />
        </div>
      ) : null}
    </>
  );
}

/* ---------------- results ---------------- */

const TPart = React.memo(function TPart({ label, status, text, error, dir }) {
  return (
    <section className={`tpart ${status}`}>
      <div className="tpart-h">
        <span className="chip"><Bi t={label} inline /></span>
        {status === 'failed' ? <span className="chip urgent"><Bi t={b('ما اكتمل', 'Failed')} inline /></span> : null}
        {status === 'stopped' ? <span className="chip warn"><Bi t={b('متوقف', 'Stopped')} inline /></span> : null}
      </div>
      {status === 'failed' ? <p className="part-err"><Bi t={error} /></p> : null}
      {text ? <Markdown text={text} dir={dir} /> : status === 'running' || status === 'queued' ? <div className="skel-lines" aria-hidden="true"><i /><i /><i /></div> : null}
    </section>
  );
});

function baseName(name) {
  return split(name)[0].replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'study';
}

function JobPanel({ job, source, onSummarise }) {
  const { notify } = useStore();
  const ref = useRef(null);
  const running = job.status === 'running';
  const total = job.parts.length;
  const done = job.parts.filter((p) => p.status === 'done').length;
  const unfinished = job.parts.filter((p) => p.status === 'failed' || p.status === 'stopped');
  const active = job.parts.find((p) => p.status === 'running');
  const isT = job.task === 'translate';
  const dir = isT ? (job.options.target === 'en' ? 'ltr' : 'rtl') : undefined;
  const text = () => (isT ? translationText(job) : studyText(job));

  useEffect(() => { if (running) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [job.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While the free tier asks us to wait, tick once a second so the countdown moves.
  const [, tick] = useState(0);
  const paused = running && job.pauseUntil > Date.now();
  useEffect(() => {
    if (!paused) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);
  const waitSec = paused ? Math.max(1, Math.ceil((job.pauseUntil - Date.now()) / 1000)) : 0;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text()); notify(b('تم النسخ', 'Copied')); } catch { notify(b('ما كدرنا ننسخ. جرّب التنزيل.', 'Couldn\'t copy. Try downloading instead.')); }
  };
  const download = () => {
    const blob = new Blob(['﻿', `${split(job.name)[0]}\n${split(TASK_LABEL[job.task])[0]}\n\n`, text()], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${baseName(job.name)}-${isT ? 'ترجمة' : 'ملخص'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  return (
    <article className="panel job print-area" ref={ref} aria-busy={running}>
      <div className="job-head">
        <div className="min0">
          <h2><Bi t={TASK_LABEL[job.task]} /></h2>
          <p className="note"><Bi t={job.fromHistory ? joinBi(job.name, agoBi(job.createdAt)) : job.name} /></p>
        </div>
        {!running ? <button className="icon-btn no-print" type="button" onClick={closeJob} aria-label="إغلاق النتيجة / Close result"><X size={18} /></button> : null}
      </div>

      {running ? (
        <div className="prog no-print">
          <div className="bar" role="progressbar" aria-label="التقدم / Progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <i style={{ width: `${Math.max(4, (done / Math.max(total, 1)) * 100)}%` }} />
          </div>
          <div className="prog-row">
            <p className="note" aria-live="polite">
              <Bi t={b(`تم ${done} من ${total} أجزاء`, `${done} of ${total} parts done`)} inline />
              {paused
                ? <> · <Bi t={b(`خدمة Gemini المجانية مزدحمة، نكمل بعد ${waitSec} ثانية…`, `The free Gemini service is busy; continuing in ${waitSec} s…`)} inline /></>
                : active?.phase && PHASE[active.phase] ? <> · <Bi t={PHASE[active.phase]} inline /></> : null}
            </p>
            <button className="btn ghost sm" type="button" onClick={stopJob}><Square size={14} aria-hidden="true" /><Bi t={b('إيقاف', 'Stop')} /></button>
          </div>
        </div>
      ) : null}

      {job.error ? <div className="notice alert" role="alert"><Bi t={job.error} /></div> : null}
      {!running && unfinished.length && !job.fromHistory && job.src === source ? (
        <div className="banner no-print" role="status">
          <span><Bi t={b(`${unfinished.length} من الأجزاء ما اكتملت.`, `${unfinished.length} part(s) didn't finish.`)} /></span>
          <button type="button" onClick={resumeJob}><RotateCcw size={14} aria-hidden="true" /> <Bi t={b('أكمل', 'Continue')} inline /></button>
        </div>
      ) : null}

      {isT ? (
        <div className="tparts">
          {job.parts.map((p) => <TPart key={p.id} label={p.label} status={p.status} text={p.text} error={p.error} dir={dir} />)}
        </div>
      ) : (
        <>
          <StudyResults job={job} />
          {unfinished.length ? (
            <ul className="part-errs">
              {unfinished.map((p) => <li key={p.id}><Bi t={p.label} inline />: <Bi t={p.error || b('متوقف', 'Stopped')} inline /></li>)}
            </ul>
          ) : null}
        </>
      )}

      {!running && done ? (
        <div className="row job-actions no-print">
          <button className="btn ghost sm" type="button" onClick={copy}><Copy size={15} aria-hidden="true" /><Bi t={b('نسخ', 'Copy')} /></button>
          <button className="btn ghost sm" type="button" onClick={download}><Download size={15} aria-hidden="true" /><Bi t={b('تنزيل', 'Download')} /></button>
          <button className="btn ghost sm" type="button" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /><Bi t={b('طباعة / PDF', 'Print / PDF')} /></button>
          {isT ? <button className="btn sm" type="button" onClick={onSummarise}><Sparkles size={15} aria-hidden="true" /><Bi t={b('لخّص وطلّع أسئلة', 'Summarise & make questions')} /></button> : null}
        </div>
      ) : null}
    </article>
  );
}

/* ---------------- screen ---------------- */

export default function Study() {
  const { notify } = useStore();
  const { source, range, job, history } = useStudy();
  const [opts, setOpts] = useState(() => ({ ...DEFAULTS, ...lsGet(OPTS_SLOT, {}) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const optsRef = useRef(null);
  const running = job?.status === 'running';

  useEffect(() => { lsSet(OPTS_SLOT, opts); }, [opts]);

  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));

  const load = async (files) => {
    setErr('');
    setBusy(true);
    try { setSource(await readFiles(files, source)); } catch (e) {
      setErr(e instanceof FileError ? e.message : b('ما كدرنا نقرأ الملف.', 'We couldn\'t read the file.'));
    } finally { setBusy(false); }
  };
  const pasteText = (t) => {
    setErr('');
    try { setSource(textSource(b('نص ملصوق', 'Pasted text'), t)); } catch (e) { setErr(e.message); }
  };

  const options = useMemo(() => ({ ...opts, range: source?.kind === 'pdf' ? range : undefined }), [opts, range, source]);
  // How many requests this will take (planning only builds descriptors; nothing is read or sent).
  const [parts, planErr] = useMemo(() => {
    if (!source || (opts.task === 'study' && !opts.formats.length)) return [0, ''];
    try { return [planJob(source, options).length, '']; } catch (e) { return [0, e.message]; }
  }, [source, options, opts.task, opts.formats.length]);
  const rangeBad = source?.kind === 'pdf' && (range.from > range.to || range.to - range.from + 1 > LIMITS.pages);
  const tooBig = parts > MAX_PARTS;
  const canStart = source && !running && !busy && parts > 0 && !tooBig && !rangeBad;

  const start = () => {
    setErr('');
    try { startJob(options); } catch (e) { setErr(e instanceof FileError ? e.message : b('ما كدرنا نبدأ.', 'Couldn\'t start.')); }
  };

  const summarise = () => {
    if (!job) return;
    setErr('');
    if (!(job.src && job.src === source)) {
      try { sourceFromTranslation(job); } catch (e) {
        const msg = e instanceof FileError ? e.message : b('ما كدرنا نجهّز الترجمة للتلخيص.', 'Couldn\'t prepare the translation for summarising.');
        setErr(msg);
        notify(msg);
        return;
      }
    }
    setOpts((o) => ({ ...o, task: 'study', formats: o.formats.length ? o.formats : DEFAULTS.formats }));
    notify(b('اختار شنو تريد يطلع، وبعدين اضغط «ابدأ التلخيص».', 'Pick what you want, then press "Start".'));
    setTimeout(() => optsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  return (
    <div className="stack-lg study">
      <div className="sec-head no-print">
        <div>
          <h1><Bi t={b('المترجم والملخّص', 'Translate & summarise')} /></h1>
          <p><Bi t={b('ترجم الملزمة، أو حوّلها لخلاصة وأسئلة امتحانية', 'Translate a handout, or turn it into a summary and exam questions')} /></p>
        </div>
      </div>

      <article className="panel no-print">
        <h2><span className="step num" aria-hidden="true">1</span><Bi t={b('الملف', 'The file')} /></h2>
        {source ? (
          <SourceCard
            source={source} range={range} setRange={setRange} locked={running || busy}
            onAddPhotos={load} onRemoveImage={(i) => setSource(removeImage(source, i))} onClear={() => { setErr(''); setSource(null); }}
          />
        ) : <Picker busy={busy} onFiles={load} onText={pasteText} />}
        {busy ? <p className="loading" role="status"><span className="spinner sm" aria-hidden="true" /><Bi t={b('جاري قراءة الملف…', 'Reading the file…')} inline /></p> : null}
        {err ? <div className="form-err" role="alert"><Bi t={err} /></div> : null}
      </article>

      <article className="panel no-print" ref={optsRef}>
        <h2><span className="step num" aria-hidden="true">2</span><Bi t={b('شنو تريد؟', 'What do you need?')} /></h2>
        <div className="opts-grid">
          <Chips label={b('المهمة', 'Task')} value={opts.task} onChange={set('task')}
            options={[['translate', b('ترجمة', 'Translate'), Languages], ['study', b('تلخيص وأسئلة', 'Summary & questions'), ListChecks]]} />

          {opts.task === 'translate' ? (
            <>
              <OptLabel>{b('ترجم إلى', 'Translate into')}</OptLabel>
              <Chips label={b('لغة الترجمة', 'Target language')} value={opts.target} onChange={set('target')}
                options={[['ar', b('العربية', 'Arabic')], ['en', b('الإنكليزية', 'English')]]} />
              {opts.target === 'ar' ? (
                <label className="check">
                  <input type="checkbox" checked={opts.keepTerms} onChange={(e) => set('keepTerms')(e.target.checked)} />
                  <Bi t={b('اكتب المصطلح الإنكليزي بين قوسين — مثل: الخلية (Cell)', 'Keep the English term in brackets — e.g. الخلية (Cell)')} />
                </label>
              ) : null}
            </>
          ) : (
            <>
              <div className="opt-row">
                <OptLabel>{b('شنو نطلّع؟', 'What should we make?')}</OptLabel>
                <div className="row">
                  <button type="button" className="link" onClick={() => set('formats')([...FORMATS])}><Bi t={b('الكل', 'All')} inline /></button>
                  <button type="button" className="link" onClick={() => set('formats')(['summary', 'mcq', 'true_false'])}><Bi t={b('مراجعة سريعة', 'Quick review')} inline /></button>
                </div>
              </div>
              <Chips multi label={b('أنواع المحتوى', 'Content types')} value={opts.formats} onChange={set('formats')}
                options={FORMATS.map((f) => [f, FORMAT_META[f].label])} />
              {!opts.formats.length ? <p className="form-err" role="alert"><Bi t={b('اختار نوع واحد على الأقل.', 'Choose at least one type.')} /></p> : null}
              <OptLabel>{b('المستوى', 'Depth')}</OptLabel>
              <Chips label={b('المستوى', 'Depth')} value={opts.depth} onChange={set('depth')} options={DEPTHS} />
              <OptLabel>{b('لغة الملخص والأسئلة', 'Language of the output')}</OptLabel>
              <Chips label={b('لغة الملخص والأسئلة', 'Language of the output')} value={opts.lang} onChange={set('lang')}
                options={[['ar', b('العربية', 'Arabic')], ['en', b('الإنكليزية', 'English')], ['both', b('الاثنين', 'Both')]]} />
            </>
          )}
        </div>

        <div className="start-row">
          <button className="btn" type="button" disabled={!canStart} onClick={start}>
            {opts.task === 'translate' ? <Languages size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
            <Bi t={opts.task === 'translate' ? b('ابدأ الترجمة', 'Start translating') : b('ابدأ التلخيص', 'Start')} />
          </button>
          {source && parts && !tooBig ? <span className="note"><Bi t={b(`راح ينقسم إلى ${parts} ${parts >= 2 && parts <= 10 ? 'أجزاء' : 'جزء'}`, `${parts} part${parts === 1 ? '' : 's'}`)} inline /></span> : null}
          {!source ? <span className="note"><Bi t={b('اختار ملف أول.', 'Choose a file first.')} inline /></span> : null}
        </div>
        {tooBig ? <p className="form-err" role="alert"><Bi t={tooBigMsg(parts)} /></p> : null}
        {planErr ? <p className="form-err" role="alert"><Bi t={planErr} /></p> : null}
      </article>

      {job ? <JobPanel job={job} source={source} onSummarise={summarise} /> : null}

      {history.length ? (
        <article className="panel no-print">
          <h2><span className="h2-l"><History size={18} aria-hidden="true" /><Bi t={b('آخر النتائج', 'Recent results')} /></span></h2>
          <ul className="hist">
            {history.map((h) => (
              <li key={h.id} className={job?.id === h.id ? 'on' : undefined}>
                <button type="button" className="hist-open" disabled={running} onClick={() => openHistory(h.id)}>
                  <span className="t"><Bi t={h.name} /></span>
                  <span className="m"><Bi t={joinBi(TASK_LABEL[h.task], agoBi(h.createdAt), h.complete ? '' : b('غير مكتمل', 'incomplete'))} /></span>
                </button>
                <button type="button" className="icon-btn" onClick={() => deleteHistory(h.id)} aria-label={`حذف «${flat(h.name)}» / Delete`}><Trash2 size={17} /></button>
              </li>
            ))}
          </ul>
          <p className="note"><Bi t={b('النتائج محفوظة على هذا الجهاز فقط.', 'Results are saved on this device only.')} /></p>
        </article>
      ) : null}

      <p className="note no-print">
        <Bi t={b(`الملف يُرسل إلى خدمة Gemini من Google حتى يُعالج، وما ينحفظ بخادم القسم. لأنها الخطة المجانية، Google تكدر تستخدم المحتوى لتحسين خدماتها، فلا ترفع ملفات بيها معلومات شخصية. حصة كل طالب ${MAX_PARTS} جزء باليوم. الذكاء الاصطناعي دقيق بس ممكن يغلط أحياناً، لهذا كل نقطة وسؤال عليه رقم الصفحة حتى تراجعه بالملزمة.`,
          `Files are sent to Google's Gemini service for processing and aren't stored on the department's server. Because this is the free tier, Google may use the content to improve its services, so don't upload files with personal information. Each student can process ${MAX_PARTS} parts a day. The AI is accurate but can still make mistakes, so every point and question shows its page number for you to check against the handout.`)} />
      </p>
    </div>
  );
}
