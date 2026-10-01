import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SWATCHES, safeUrl } from './util';
import { b, split, flat, Bi, T } from './bi';

export function CellMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="cellmark">
      <circle cx="20" cy="20" r="18" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.6" />
      <ellipse cx="22.5" cy="18" rx="6.2" ry="5.4" fill="var(--accent)" />
      <circle cx="24" cy="17" r="1.8" fill="var(--accent-soft)" />
      <circle cx="11.5" cy="24.5" r="2" fill="var(--accent)" opacity=".55" />
      <circle cx="16" cy="29" r="1.4" fill="var(--accent)" opacity=".55" />
      <path d="M27 27.5c2 .6 3.6-.3 4.2-2" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

// Seeded so the scene is identical on every load (no random layout jumps).
const seeded = (i, n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
// Static pose of each rung (used when motion is off or reduced) and the start phase of the animation.
const RUNGS = Array.from({ length: 26 }, (_, i) => {
  const a = i * 0.449; // one full turn every 14 rungs
  return { i, sx: Math.sin(a).toFixed(3), ax: Math.abs(Math.sin(a)).toFixed(3), z1: (0.95 + 0.35 * Math.cos(a)).toFixed(3), z2: (0.95 - 0.35 * Math.cos(a)).toFixed(3) };
});
const SPORES = Array.from({ length: 18 }, (_, i) => ({
  x: 2 + Math.round(seeded(i, 1) * 96), s: 3 + Math.round(seeded(i, 2) * 7), d: 20 + Math.round(seeded(i, 3) * 24),
  t: -Math.round(seeded(i, 4) * 44), w: Math.round((seeded(i, 5) - 0.5) * 90),
}));
const BUBBLES = [
  { x: 38, s: 92, d: 34, t: -6 }, { x: 12, s: 46, d: 26, t: -18 }, { x: 68, s: 128, d: 44, t: -28 },
  { x: 90, s: 58, d: 30, t: -12 }, { x: 52, s: 34, d: 24, t: -2 },
];

// Fixed decorative scene behind the whole app. Everything moves with transform/opacity only (GPU-cheap):
// aurora light, drifting orbs, a rotating DNA strand, a breathing cell, rising spores and glass bubbles.
export function Backdrop() {
  return (
    <div className="scene" aria-hidden="true">
      <i className="orb o1" /><i className="orb o2" /><i className="orb o3" /><i className="orb o4" />
      <i className="veil v1" /><i className="veil v2" />
      <div className="helix">
        {RUNGS.map((r) => (
          <span key={r.i} className="rung" style={{ '--i': r.i, '--sx': r.sx, '--ax': r.ax, '--z1': r.z1, '--z2': r.z2 }}><b /><i className="d1" /><i className="d2" /></span>
        ))}
      </div>
      <div className="cell">
        <div className="cell-in" />
        <i className="nucleus" />
        <span className="orbit"><i className="org g1" /><i className="org g2" /><i className="org g3" /></span>
      </div>
      {SPORES.map((p, i) => (
        <i key={i} className={i % 2 ? 'spore alt' : 'spore'} style={{ '--x': `${p.x}%`, '--s': `${p.s}px`, '--d': `${p.d}s`, '--t': `${p.t}s`, '--w': `${p.w}px` }} />
      ))}
      {BUBBLES.map((p, i) => (
        <i key={i} className={i >= 3 ? 'bubble alt' : 'bubble'} style={{ '--x': `${p.x}%`, '--s': `${p.s}px`, '--d': `${p.d}s`, '--t': `${p.t}s` }} />
      ))}
    </div>
  );
}

export const Dot = ({ color }) => <span className="sdot" style={{ '--c': color || 'var(--muted)' }} aria-hidden="true" />;

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <strong><T v={title} /></strong>
      {children ? <span><T v={children} /></span> : null}
      {action}
    </div>
  );
}

export function Skeleton() {
  return (
    <div aria-hidden="true">
      <div className="skel" style={{ width: '72%' }} />
      <div className="skel" style={{ width: '46%' }} />
      <div className="skel" style={{ width: '60%' }} />
    </div>
  );
}

export function Sheet({ open, title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.querySelector('input,select,textarea,button:not(.icon-btn)')?.focus(), 40);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? flat(title) : undefined} ref={ref}>
        <div className="sheet-head">
          <h2><T v={title} /></h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="إغلاق / Close"><X size={18} /></button>
        </div>
        {children}
      </section>
    </>
  );
}

function initialValues(fields, initial) {
  const v = {};
  fields.forEach((f) => {
    const val = initial?.[f.k];
    if (f.type === 'check') v[f.k] = !!val;
    else if (f.type === 'swatch') v[f.k] = val || SWATCHES[0];
    else v[f.k] = val == null ? '' : String(val);
  });
  return v;
}

// Generic add/edit form in a sheet. onSubmit receives cleaned values and returns a promise.
export function FormSheet({ open, title, fields, initial, onSubmit, onDelete, deleteWarning, onClose, submitLabel = b('حفظ', 'Save') }) {
  const [values, setValues] = useState(() => initialValues(fields, initial));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (open) { setValues(initialValues(fields, initial)); setErr(''); setBusy(false); setArmed(false); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => { setErr(''); setValues((s) => ({ ...s, [k]: v })); };

  async function submit(e) {
    e.preventDefault();
    const out = {};
    for (const f of fields) {
      let v = values[f.k];
      if (f.type === 'check' || f.type === 'swatch') { out[f.k] = v; continue; }
      v = (v ?? '').trim();
      const [la, le] = split(f.label);
      const en = le || la;
      if (f.required && !v) { setErr(b(`اكتب ${la}.`, `Enter ${en}.`)); return; }
      if (f.type === 'url' && v && !safeUrl(v)) { setErr(b('الرابط لازم يبدي بـ https://', 'The link must start with https://')); return; }
      if (f.type === 'number') {
        if (v === '') v = null;
        else {
          const n = Number(v);
          if (!Number.isInteger(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) {
            setErr(b(`${la}: رقم بين ${f.min} و ${f.max}.`, `${en}: a number between ${f.min} and ${f.max}.`)); return;
          }
          v = n;
        }
      }
      if (f.maxLength && typeof v === 'string' && v.length > f.maxLength) {
        setErr(b(`${la} طويل (الحد ${f.maxLength} حرف).`, `${en} is too long (max ${f.maxLength} characters).`)); return;
      }
      out[f.k] = v;
    }
    setErr('');
    setBusy(true);
    try {
      await onSubmit(out);
    } catch (e2) {
      setErr(e2?.message || b('تعذّر الحفظ.', 'Couldn\'t save.'));
      setBusy(false);
    }
  }

  async function del() {
    if (!armed) { setArmed(true); return; }
    setBusy(true);
    try { await onDelete(); } catch (e2) { setErr(e2?.message || b('تعذّر الحذف.', 'Couldn\'t delete.')); setBusy(false); setArmed(false); }
  }

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        {fields.map((f) => <Field key={f.k} f={f} value={values[f.k]} onChange={(v) => set(f.k, v)} />)}
        {err ? <div className="form-err" role="alert"><Bi t={err} /></div> : null}
        {armed && deleteWarning ? <div className="form-warn"><T v={deleteWarning} /></div> : null}
        <div className="form-foot">
          <div className="row">
            <button className="btn" type="submit" disabled={busy}><Bi t={busy ? b('جارٍ الحفظ…', 'Saving…') : submitLabel} /></button>
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}><Bi t={b('إلغاء', 'Cancel')} /></button>
          </div>
          {onDelete ? (
            <button className={`btn danger ${armed ? 'armed' : ''}`} type="button" onClick={del} disabled={busy}>
              <Bi t={armed ? b('اضغط مرة ثانية للتأكيد', 'Tap again to confirm') : b('حذف', 'Delete')} />
            </button>
          ) : null}
        </div>
      </form>
    </Sheet>
  );
}

function Field({ f, value, onChange }) {
  const id = `f-${f.k}`;
  const cls = `field${f.half ? ' half' : ''}`;
  const req = f.required ? <span className="req" aria-hidden="true">*</span> : null;
  const hint = f.hint ? <span className="hint"><T v={f.hint} /></span> : null;
  if (f.type === 'check') {
    return (
      <div className={cls}>
        <label className="check" htmlFor={id}>
          <input id={id} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <T v={f.label} />
        </label>
      </div>
    );
  }
  if (f.type === 'swatch') {
    return (
      <div className={cls}>
        <span className="label"><T v={f.label} /></span>
        <div className="swatches" role="radiogroup" aria-label={flat(f.label)}>
          {SWATCHES.map((c, i) => (
            <label key={c}>
              <input type="radio" name={id} value={c} checked={value === c} onChange={() => onChange(c)} aria-label={`لون ${i + 1} / Colour ${i + 1}`} />
              <span style={{ '--c': c }} />
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (f.type === 'select') {
    return (
      <div className={cls}>
        <label htmlFor={id}><T v={f.label} />{req}</label>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {f.required && !value ? <option value="">اختر… / Select…</option> : null}
          {!f.required ? <option value="">—</option> : null}
          {f.options.map(([v, l]) => <option key={v} value={v}>{flat(l)}</option>)}
        </select>
        {hint}
      </div>
    );
  }
  if (f.type === 'textarea') {
    return (
      <div className={cls}>
        <label htmlFor={id}><T v={f.label} />{req}</label>
        <textarea id={id} value={value} placeholder={f.placeholder || ''} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />
        {hint}
      </div>
    );
  }
  const type = f.type === 'number' ? 'text' : f.type;
  return (
    <div className={cls}>
      <label htmlFor={id}><T v={f.label} />{req}</label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={f.placeholder || ''}
        maxLength={f.maxLength}
        inputMode={f.type === 'number' ? 'numeric' : undefined}
        dir={f.type === 'url' || f.ltr ? 'ltr' : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint}
    </div>
  );
}

export function Toast({ text }) {
  if (!text) return null;
  return <div className="toast" role="status" aria-live="polite"><Bi t={text} /></div>;
}
