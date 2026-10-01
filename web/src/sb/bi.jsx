import React from 'react';

// A bilingual UI string is one plain string: Arabic, a newline, then English.
// It travels through errors, toasts and props unchanged and is split only when rendered.
export const b = (ar, en) => `${ar}\n${en}`;

export function split(s) {
  const str = String(s ?? '');
  const i = str.indexOf('\n');
  return i < 0 ? [str, ''] : [str.slice(0, i), str.slice(i + 1)];
}

// Single-line form for aria-labels, <option> text and placeholders.
export function flat(s) {
  const [a, e] = split(s);
  return e ? `${a} / ${e}` : a;
}

// Arabic on top (primary), English in a smaller line underneath.
// `inline` keeps both on one line (chips, tiny tags).
export function Bi({ t, ar, en, inline = false }) {
  let a = ar;
  let e = en;
  if (t != null) [a, e] = split(t);
  if (!e) return <>{a}</>;
  return (
    <span className={inline ? 'bi inline' : 'bi'}>
      <span className="bi-ar">{a}</span>
      <span className="bi-en" lang="en" dir="ltr">{e}</span>
    </span>
  );
}

// Render a value that may be a bilingual string or ready-made JSX.
export function T({ v, inline }) {
  return typeof v === 'string' ? <Bi t={v} inline={inline} /> : (v ?? null);
}
