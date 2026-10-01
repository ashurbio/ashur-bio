// Study material views: summary, terms, interactive MCQ / true-false, and reveal-the-answer formats.
import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Check, X, RotateCcw } from 'lucide-react';
import { b, Bi } from '../bi';
import { Inline } from './md';
import { FORMATS, FORMAT_META, letters, mergeStudy, pageLabel } from './data';

const Page = ({ it }) => (it.page ? <span className="pg"><Bi t={pageLabel(it.numbering, it.page)} inline /></span> : null);
const Qn = ({ n }) => <span className="qn num" aria-hidden="true">{n}</span>;

function Reveal({ open, children }) {
  // Remount when "show all answers" flips so the native <details> follows it.
  return (
    <details className="reveal" open={open || undefined} key={open ? 'o' : 'c'}>
      <summary><Bi t={b('إظهار الجواب', 'Show answer')} inline /></summary>
      <div className="ans">{children}</div>
    </details>
  );
}

function Summary({ list }) {
  return list.map((s, i) => (
    <section key={i} className="sum-sec">
      <h3 dir="auto"><Inline text={s.heading || '—'} /> <Page it={s} /></h3>
      <ul>{s.points.map((p, j) => <li key={j} dir="auto"><Inline text={p} /></li>)}</ul>
    </section>
  ));
}

function Terms({ list }) {
  return (
    <dl className="terms">
      {list.map((t, i) => (
        <div key={i} className="term">
          <dt dir="auto"><Inline text={t.term} /> <Page it={t} /></dt>
          <dd dir="auto"><Inline text={t.definition} /></dd>
        </div>
      ))}
    </dl>
  );
}

function Mcq({ q, n, L, showAll, picked, onPick }) {
  const done = picked != null || showAll;
  return (
    <article className="q">
      <div className="q-h"><Qn n={n} /><p dir="auto"><Inline text={q.question} /></p><Page it={q} /></div>
      <div className="opts" role="group" aria-label={`خيارات السؤال ${n} / Options for question ${n}`}>
        {q.options.map((o, i) => {
          const right = done && i === q.answer;
          const wrong = picked === i && i !== q.answer;
          return (
            <button
              key={i}
              type="button"
              className={`opt${right ? ' right' : ''}${wrong ? ' wrong' : ''}`}
              aria-pressed={picked === i}
              disabled={picked != null}
              onClick={() => onPick(i)}
            >
              <span className="ol" aria-hidden="true">{L[i]}</span>
              <span className="ot" dir="auto"><Inline text={o} /></span>
              {right ? <Check size={17} aria-label="الجواب الصحيح / Correct answer" /> : wrong ? <X size={17} aria-label="جواب خطأ / Wrong answer" /> : null}
            </button>
          );
        })}
      </div>
      {done ? (
        <p className={`fb${picked == null ? '' : picked === q.answer ? ' ok' : ' no'}`} role="status">
          {picked == null ? null : picked === q.answer ? <b><Bi t={b('صح!', 'Correct!')} inline /> </b> : <b><Bi t={b(`خطأ، الجواب ${L[q.answer]}.`, `Wrong — the answer is ${L[q.answer]}.`)} inline /> </b>}
          {q.explanation ? <span dir="auto"><Inline text={q.explanation} /></span> : null}
        </p>
      ) : null}
    </article>
  );
}

function TrueFalse({ q, n, showAll, picked, onPick }) {
  const done = picked != null || showAll;
  const opts = [[true, b('صح', 'True')], [false, b('خطأ', 'False')]];
  return (
    <article className="q">
      <div className="q-h"><Qn n={n} /><p dir="auto"><Inline text={q.statement} /></p><Page it={q} /></div>
      <div className="opts tf" role="group" aria-label={`صح أو خطأ ${n} / True or false ${n}`}>
        {opts.map(([v, label]) => {
          const right = done && v === q.answer;
          const wrong = picked === v && v !== q.answer;
          return (
            <button key={String(v)} type="button" className={`opt${right ? ' right' : ''}${wrong ? ' wrong' : ''}`} aria-pressed={picked === v} disabled={picked != null} onClick={() => onPick(v)}>
              <span className="ot"><Bi t={label} inline /></span>
              {right ? <Check size={17} aria-hidden="true" /> : wrong ? <X size={17} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {done ? (
        <p className={`fb${picked == null ? '' : picked === q.answer ? ' ok' : ' no'}`} role="status">
          {picked == null ? null : picked === q.answer ? <b><Bi t={b('صح!', 'Correct!')} inline /> </b> : <b><Bi t={b('خطأ.', 'Wrong.')} inline /> </b>}
          {q.correction ? <span dir="auto"><Inline text={q.correction} /></span> : null}
        </p>
      ) : null}
    </article>
  );
}

// Answers are keyed by the question text: parts finish in any order, so positions shift while a file is still running.
const qKey = (q) => q.question || q.statement;

function Quiz({ list, kind, L, showAll }) {
  const [picks, setPicks] = useState({});
  const answered = list.filter((q) => picks[qKey(q)] != null).length;
  const right = list.filter((q) => picks[qKey(q)] != null && picks[qKey(q)] === q.answer).length;
  const pick = (q) => (v) => setPicks((p) => (p[qKey(q)] != null ? p : { ...p, [qKey(q)]: v }));
  return (
    <>
      {answered ? (
        <div className="score" role="status">
          <Bi t={b(`صحيحة ${right} من ${answered}`, `${right} of ${answered} correct`)} />
          <button type="button" className="btn ghost sm" onClick={() => setPicks({})}><RotateCcw size={15} aria-hidden="true" /><Bi t={b('إعادة', 'Reset')} /></button>
        </div>
      ) : null}
      {list.map((q, i) => (kind === 'mcq'
        ? <Mcq key={qKey(q)} q={q} n={i + 1} L={L} showAll={showAll} picked={picks[qKey(q)]} onPick={pick(q)} />
        : <TrueFalse key={qKey(q)} q={q} n={i + 1} showAll={showAll} picked={picks[qKey(q)]} onPick={pick(q)} />))}
    </>
  );
}

function QA({ list, showAll, render }) {
  return list.map((q, i) => (
    <article key={i} className="q">
      <div className="q-h"><Qn n={i + 1} /><p dir="auto"><Inline text={q.question || q.sentence} /></p><Page it={q} /></div>
      <Reveal open={showAll}>{render(q)}</Reveal>
    </article>
  ));
}

function Compare({ list, showAll }) {
  return list.map((c, i) => (
    <article key={i} className="q">
      <div className="q-h"><Qn n={i + 1} /><p dir="auto"><Inline text={c.title || `${c.a} / ${c.b}`} /></p><Page it={c} /></div>
      <Reveal open={showAll}>
        <div className="md-table" role="region" aria-label={`مقارنة ${i + 1} / Comparison ${i + 1}`} tabIndex={0}>
          <table dir="auto">
            <thead><tr><th scope="col"><Bi t={b('وجه المقارنة', 'Aspect')} inline /></th><th scope="col"><Inline text={c.a} /></th><th scope="col"><Inline text={c.b} /></th></tr></thead>
            <tbody>{c.rows.map((r, j) => <tr key={j}><th scope="row"><Inline text={r.aspect} /></th><td><Inline text={r.a} /></td><td><Inline text={r.b} /></td></tr>)}</tbody>
          </table>
        </div>
      </Reveal>
    </article>
  ));
}

// A printout should carry the answers: reveal them all while printing (also on Ctrl+P), then restore.
function usePrintReveal(showAll, setShowAll) {
  const prev = useRef(showAll);
  const now = useRef(showAll);
  now.current = showAll;
  useEffect(() => {
    const before = () => { prev.current = now.current; flushSync(() => setShowAll(true)); };
    const after = () => setShowAll(prev.current);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, [setShowAll]);
}

const answerText = (q) => <p dir="auto"><Inline text={q.answer} /></p>;
const listItems = (q) => <ol>{q.items.map((x, k) => <li key={k} dir="auto"><Inline text={x} /></li>)}</ol>;

export function StudyResults({ job }) {
  const merged = mergeStudy(job.parts);
  const available = FORMATS.filter((f) => (job.options.formats || []).includes(f));
  const [tab, setTab] = useState(available[0]);
  const [showAll, setShowAll] = useState(false);
  usePrintReveal(showAll, setShowAll);
  const cur = available.includes(tab) ? tab : available[0];
  const list = merged[cur] || [];
  const L = letters(job.options.lang);
  const dir = job.options.lang === 'en' ? 'ltr' : 'rtl';

  return (
    <div className="study-out">
      {merged.topics.length ? <p className="topics" dir="auto">{merged.topics.join(' · ')}</p> : null}
      <div className="filters no-print" role="group" aria-label="نوع المحتوى / Content type">
        {available.map((f) => (
          <button key={f} type="button" className="fchip" aria-pressed={cur === f} onClick={() => setTab(f)}>
            <Bi t={FORMAT_META[f].label} /> <span className="cnt num">{merged[f].length}</span>
          </button>
        ))}
      </div>
      {['mcq', 'true_false', 'lists', 'reasons', 'compare', 'blanks', 'essay'].includes(cur) ? (
        <label className="check switch no-print">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <Bi t={b('إظهار كل الأجوبة', 'Show all answers')} />
        </label>
      ) : null}
      {/* Every format is rendered for printing; only the chosen one shows on screen. */}
      {available.map((f) => (
        <section key={f} className={`fmt${f === cur ? ' on' : ''}`} dir={dir}>
          <h3 className="print-only"><Bi t={FORMAT_META[f].label} inline /></h3>
          <FormatBody f={f} list={merged[f]} L={L} showAll={showAll} />
        </section>
      ))}
      {!list.length && job.status !== 'running' ? <p className="note"><Bi t={b('ما طلع محتوى من هذا النوع لهذا الملف.', 'Nothing of this type came out of this file.')} /></p> : null}
      {merged.notes.length ? (
        <div className="notes-box">
          <b><Bi t={b('ملاحظات', 'Notes')} inline /></b>
          <ul>{merged.notes.map((x, i) => <li key={i} dir="auto"><Bi t={x.label} inline />: {x.text}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

function FormatBody({ f, list, L, showAll }) {
  if (!list.length) return null;
  switch (f) {
    case 'summary': return <Summary list={list} />;
    case 'terms': return <Terms list={list} />;
    case 'mcq': return <Quiz list={list} kind="mcq" L={L} showAll={showAll} />;
    case 'true_false': return <Quiz list={list} kind="tf" L={L} showAll={showAll} />;
    case 'lists': return <QA list={list} showAll={showAll} render={listItems} />;
    case 'compare': return <Compare list={list} showAll={showAll} />;
    case 'blanks': return <QA list={list} showAll={showAll} render={answerText} />;
    default: return <QA list={list} showAll={showAll} render={answerText} />;
  }
}
