// A small, safe Markdown renderer for translations: headings, lists, tables, bold, page markers.
// It builds React elements directly (no innerHTML), so nothing in the model's output can inject markup.
import React from 'react';

// **bold** only; single asterisks are common in science text (5*, p*), so they stay literal.
export function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*\n]+?\*\*)/g);
  return parts.map((p, i) => (p.startsWith('**') && p.endsWith('**') && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
}

const MARKER = /^-{2,}\s*(.+?)\s*-{2,}$/;
const HEAD = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const NUM = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

function parse(src) {
  const lines = String(src).replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    let m;
    if ((m = t.match(MARKER)) && !/^-+$/.test(m[1])) { blocks.push({ type: 'marker', text: m[1] }); i++; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { blocks.push({ type: 'rule' }); i++; continue; }
    if ((m = t.match(HEAD))) { blocks.push({ type: 'h', level: m[1].length, text: m[2] }); i++; continue; }
    if (ROW.test(line)) {
      const rows = [];
      while (i < lines.length && (ROW.test(lines[i]) || SEP.test(lines[i]))) {
        if (!SEP.test(lines[i])) rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', rows });
      continue;
    }
    if (BULLET.test(line) || NUM.test(line)) {
      const items = [];
      while (i < lines.length && (BULLET.test(lines[i]) || NUM.test(lines[i]))) {
        const b = lines[i].match(BULLET);
        const n = lines[i].match(NUM);
        const indent = ((b || n)[1] || '').replace(/\t/g, '  ').length;
        items.push({ deep: indent >= 2, num: n ? Number(n[2]) : null, text: n ? n[3] : b[2] });
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }
    if (t.startsWith('>')) {
      const q = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) { q.push(lines[i].trim().replace(/^>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: q.join('\n') });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !HEAD.test(lines[i].trim()) && !ROW.test(lines[i]) && !BULLET.test(lines[i]) && !NUM.test(lines[i]) && !MARKER.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    else i++;
  }
  return blocks;
}

function Lines({ text }) {
  const ls = text.split('\n');
  return ls.map((l, i) => <React.Fragment key={i}>{i ? <br /> : null}<Inline text={l} /></React.Fragment>);
}

export function Markdown({ text, dir }) {
  const blocks = parse(text);
  return (
    <div className="md" dir={dir}>
      {blocks.map((bl, k) => {
        switch (bl.type) {
          case 'marker': return <div key={k} className="pg-mark" dir="auto">{bl.text}</div>;
          case 'rule': return <hr key={k} />;
          case 'h': {
            const Tag = bl.level <= 1 ? 'h3' : bl.level === 2 ? 'h4' : 'h5';
            return <Tag key={k} dir="auto"><Inline text={bl.text} /></Tag>;
          }
          case 'table': {
            const [head, ...body] = bl.rows;
            return (
              <div key={k} className="md-table" role="region" aria-label="جدول / Table" tabIndex={0}>
                <table dir="auto">
                  {head ? <thead><tr>{head.map((c, j) => <th key={j} scope="col"><Inline text={c} /></th>)}</tr></thead> : null}
                  <tbody>{body.map((r, j) => <tr key={j}>{r.map((c, x) => <td key={x}><Inline text={c} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          }
          case 'list': {
            const ordered = bl.items[0].num != null;
            const Tag = ordered ? 'ol' : 'ul';
            return (
              <Tag key={k}>
                {bl.items.map((it, j) => <li key={j} value={it.num ?? undefined} className={it.deep ? 'deep' : undefined} dir="auto"><Inline text={it.text} /></li>)}
              </Tag>
            );
          }
          case 'quote': return <blockquote key={k} dir="auto"><Lines text={bl.text} /></blockquote>;
          default: {
            const fig = /^\[(شكل|Figure)\s*[:：]/i.test(bl.text);
            const unclear = /\[(غير واضح|unclear)\]/i.test(bl.text);
            return <p key={k} dir="auto" className={fig ? 'fig' : unclear ? 'has-unclear' : undefined}><Lines text={bl.text} /></p>;
          }
        }
      })}
    </div>
  );
}
