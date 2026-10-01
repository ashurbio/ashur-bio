// Reading study files in the browser and cutting them into small parts the study-ai function can handle.
// PDF pages are split with pdf-lib (loaded only when a PDF is opened), photos are resized to JPEG,
// Word / PowerPoint text is read straight from the .docx / .pptx zip, and plain text is used as is.
import { b } from '../bi';

export class FileError extends Error {}

// Keep numbers and ranges left-to-right inside Arabic text ("1–2" would otherwise show as "2–1").
export const iso = (v) => `\u2066${v}\u2069`;

const MB = 1024 * 1024;
export const LIMITS = { fileBytes: 60 * MB, images: 40, pages: 80, textChars: 400_000 };
// Raw bytes per request (base64 adds a third). A single page may go above this; the function allows ~9 MB.
const TARGET_BYTES = 4.5 * MB;
const IMAGE_EDGE = 2200; // long edge in px: enough to read small print in photos of handouts

const ext = (name) => (name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
const isImage = (f) => (f.type || '').startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(ext(f.name));
const kindOf = (f) => {
  const e = ext(f.name);
  if (f.type === 'application/pdf' || e === 'pdf') return 'pdf';
  if (isImage(f)) return 'image';
  if (e === 'docx') return 'docx';
  if (e === 'pptx') return 'pptx';
  if (['txt', 'md', 'csv'].includes(e) || (f.type || '').startsWith('text/')) return 'text';
  if (['doc', 'ppt', 'rtf', 'odt', 'odp'].includes(e)) return 'old';
  return 'other';
};

export function toBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* ---------------------------------------------------------------- PDF */

let pdfLib;
const loadPdfLib = () => (pdfLib ??= import('pdf-lib'));

async function readPdf(file) {
  const { PDFDocument } = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e?.message))) {
      throw new FileError(b('هذا الـ PDF محمي بكلمة سر أو بقفل. افتحه واطبعه كـ PDF جديد («حفظ كـ PDF») وارفعه مرة ثانية، أو صوّر صفحاته.',
        'This PDF is password-protected or locked. Open it, print it to a new PDF ("Save as PDF") and upload that, or take photos of the pages.'));
    }
    throw new FileError(b('ما كدرنا نفتح ملف الـ PDF. تأكد إنه سليم.', 'We couldn\'t open this PDF. Make sure the file isn\'t damaged.'));
  }
  const pages = doc.getPageCount();
  if (!pages) throw new FileError(b('الـ PDF فارغ.', 'This PDF has no pages.'));
  return { kind: 'pdf', name: file.name, size: file.size, pages, doc };
}

async function pdfPieces(source, first, last) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  const idx = [];
  for (let p = first; p <= last; p++) idx.push(p - 1);
  const copied = await out.copyPages(source.doc, idx);
  copied.forEach((pg) => out.addPage(pg));
  const bytes = await out.save({ useObjectStreams: true });
  return { pieces: [{ kind: 'pdf', data: toBase64(bytes) }], bytes: bytes.length };
}

/* ---------------------------------------------------------------- images */

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Safari can decode HEIC through <img> even where createImageBitmap refuses it.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
}

async function readImage(file) {
  let bmp;
  try { bmp = await decode(file); } catch {
    throw new FileError(b(`ما كدرنا نقرأ الصورة «${file.name}». حوّلها إلى JPG أو PNG.`, `We couldn't read the image "${file.name}". Convert it to JPG or PNG.`));
  }
  const w = bmp.width || bmp.naturalWidth;
  const h = bmp.height || bmp.naturalHeight;
  const scale = Math.min(1, IMAGE_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // transparent PNGs become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
  if (!blob) throw new FileError(b('ما كدرنا نجهّز الصورة.', 'We couldn\'t prepare the image.'));
  return { name: file.name, blob, url: URL.createObjectURL(blob), w: canvas.width, h: canvas.height };
}

/* ---------------------------------------------------------------- .docx / .pptx (zip + XML) */

// Minimal zip reader: central directory + DEFLATE via the browser's DecompressionStream.
async function unzip(buf, want) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = {};
  for (let k = 0; k < n; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad zip');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, csize);
    if (method === 0) out[name] = dec.decode(data);
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new FileError(b('متصفحك قديم وما يكدر يقرأ ملفات Word أو PowerPoint. حدّثه أو حوّل الملف إلى PDF.', 'Your browser is too old to read Word or PowerPoint files. Update it or convert the file to PDF.'));
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[name] = dec.decode(await new Response(stream).arrayBuffer());
    }
  }
  return out;
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el) => Array.from(el.children || []);
const local = (el) => el.localName;
const attr = (el, name) => {
  for (const a of Array.from(el.attributes || [])) if (a.localName === name) return a.value;
  return null;
};

// Text of a run container in document order: w:t / a:t text, tabs and line breaks.
function runText(el) {
  let s = '';
  const walk = (n) => {
    for (const c of kids(n)) {
      const ln = local(c);
      if (ln === 't') s += c.textContent;
      else if (ln === 'tab') s += ' ';
      else if (ln === 'br' || ln === 'cr') s += '\n';
      else if (ln !== 'rPr' && ln !== 'pPr' && ln !== 'instrText' && ln !== 'delText') walk(c);
    }
  };
  walk(el);
  return s.replace(/[ \t]+/g, ' ').trim();
}

function docxParagraphs(docXml) {
  const body = xml(docXml).getElementsByTagNameNS('*', 'body')[0];
  if (!body) return [];
  const out = [];
  const para = (p) => {
    const t = runText(p);
    if (!t) return;
    const pPr = kids(p).find((c) => local(c) === 'pPr');
    const style = pPr && kids(pPr).find((c) => local(c) === 'pStyle');
    const sv = style ? attr(style, 'val') || '' : '';
    const hm = sv.match(/heading\s*(\d)/i) || (/^title$/i.test(sv) ? [0, '1'] : null);
    const list = pPr && kids(pPr).some((c) => local(c) === 'numPr');
    out.push(hm ? `${'#'.repeat(Math.min(3, Number(hm[1]) || 1))} ${t}` : list ? `- ${t}` : t);
  };
  const walk = (el) => {
    for (const c of kids(el)) {
      const ln = local(c);
      if (ln === 'p') para(c);
      else if (ln === 'tbl') {
        const rows = c.getElementsByTagNameNS('*', 'tr');
        const lines = [];
        for (const tr of Array.from(rows)) {
          const cells = kids(tr).filter((x) => local(x) === 'tc').map((tc) => runText(tc).replace(/\n/g, ' ').replace(/\|/g, '/'));
          if (cells.some(Boolean)) lines.push(`| ${cells.join(' | ')} |`);
        }
        if (lines.length) out.push(lines.join('\n'));
      } else if (ln === 'sdt' || ln === 'sdtContent' || ln === 'customXml') walk(c);
    }
  };
  walk(body);
  return out;
}

function slideText(sXml) {
  const doc = xml(sXml);
  const lines = [];
  for (const p of Array.from(doc.getElementsByTagNameNS('*', 'p'))) {
    if (p.namespaceURI && !/drawingml/.test(p.namespaceURI)) continue; // a:p only
    const t = runText(p);
    if (!t) continue;
    const pPr = kids(p).find((c) => local(c) === 'pPr');
    const lvl = pPr ? Number(attr(pPr, 'lvl') || 0) : 0;
    lines.push(lvl > 0 ? `${'  '.repeat(lvl - 1)}- ${t}` : t);
  }
  return lines.join('\n');
}

async function readPptx(file) {
  const entries = await unzip(await file.arrayBuffer(), (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) || n === 'ppt/presentation.xml' || n === 'ppt/_rels/presentation.xml.rels');
  // Slide order comes from presentation.xml (slides can be reordered without renaming their files).
  let order = [];
  try {
    const rels = {};
    for (const r of Array.from(xml(entries['ppt/_rels/presentation.xml.rels']).getElementsByTagNameNS('*', 'Relationship'))) {
      rels[r.getAttribute('Id')] = `ppt/${r.getAttribute('Target').replace(/^\/?ppt\//, '').replace(/^\.\//, '')}`;
    }
    // <p:sldId id="256" r:id="rId3"/>: two attributes are called "id"; the slide link is the relationships one.
    const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    order = Array.from(xml(entries['ppt/presentation.xml']).getElementsByTagNameNS('*', 'sldId'))
      .map((s) => rels[s.getAttributeNS(REL, 'id')]).filter((p) => entries[p]);
  } catch { order = []; }
  if (!order.length) {
    order = Object.keys(entries).filter((n) => /slides\/slide\d+\.xml$/.test(n))
      .sort((a, c) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(c.match(/(\d+)\.xml$/)[1]));
  }
  const units = order.map((path, i) => ({ n: i + 1, text: slideText(entries[path]) }));
  if (!units.some((u) => u.text)) throw new FileError(b('ما لكينا نص بالشرائح (ممكن تكون صور). صوّر الشرائح أو احفظها PDF وارفعها.', 'No text found in the slides (they may be pictures). Save them as PDF or upload photos instead.'));
  return { kind: 'slides', name: file.name, size: file.size, units, total: units.length };
}

async function readDocx(file) {
  const entries = await unzip(await file.arrayBuffer(), (n) => n === 'word/document.xml');
  if (!entries['word/document.xml']) throw new Error('no document');
  return textSource(file.name, docxParagraphs(entries['word/document.xml']).join('\n\n'), file.size);
}

/* ---------------------------------------------------------------- plain text */

export function textSource(name, text, size = text.length) {
  const clean = String(text || '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!clean) throw new FileError(b('ما لكينا نص بالملف.', 'No text found in this file.'));
  if (clean.length > LIMITS.textChars) throw new FileError(b('النص طويل جداً. قسّمه وارفع جزء بجزء.', 'The text is too long. Split it and upload one part at a time.'));
  return { kind: 'text', name, size, text: clean };
}

/* ---------------------------------------------------------------- entry point */

// files: File[] from an <input> or a drop. `current` is the source already chosen (to add more photos to it).
export async function readFiles(files, current) {
  const list = Array.from(files || []);
  if (!list.length) return current;
  for (const f of list) {
    if (f.size > LIMITS.fileBytes) throw new FileError(b(`الملف «${f.name}» أكبر من 60 ميغابايت.`, `"${f.name}" is larger than 60 MB.`));
  }
  const kinds = new Set(list.map(kindOf));
  if (kinds.has('old')) throw new FileError(b('صيغة Word أو PowerPoint القديمة (.doc / .ppt) غير مدعومة. احفظ الملف بصيغة PDF أو DOCX أو PPTX.', 'Old Word/PowerPoint files (.doc / .ppt) aren\'t supported. Save it as PDF, DOCX or PPTX.'));
  if (kinds.has('other')) throw new FileError(b('نوع الملف غير مدعوم. الأنواع المدعومة: PDF، صور، Word (docx)، PowerPoint (pptx)، نص.', 'Unsupported file type. Use PDF, images, Word (docx), PowerPoint (pptx) or text.'));
  if (kinds.size > 1 || (list.length > 1 && !kinds.has('image'))) {
    throw new FileError(b('اختار ملف واحد، أو مجموعة صور فقط.', 'Choose a single file, or a set of photos only.'));
  }
  const kind = [...kinds][0];
  if (kind === 'image') {
    const base = current?.kind === 'images' ? current.items : [];
    if (base.length + list.length > LIMITS.images) throw new FileError(b(`الحد ${LIMITS.images} صورة بالمرة الوحدة.`, `Up to ${LIMITS.images} photos at a time.`));
    // Photos picked together are usually named in shooting order (IMG_0012, IMG_0013 …).
    list.sort((a, c) => a.name.localeCompare(c.name, undefined, { numeric: true }));
    const items = [];
    for (const f of list) items.push(await readImage(f));
    const all = [...base, ...items];
    return { kind: 'images', name: all.length === 1 ? all[0].name : b(`${all.length} صور`, `${all.length} photos`), items: all, total: all.length };
  }
  if (current?.kind === 'images') releaseSource(current);
  const f = list[0];
  try {
    if (kind === 'pdf') return await readPdf(f);
    if (kind === 'docx') return await readDocx(f);
    if (kind === 'pptx') return await readPptx(f);
    return textSource(f.name, await f.text(), f.size);
  } catch (e) {
    if (e instanceof FileError) throw e;
    throw new FileError(b('ما كدرنا نقرأ الملف. تأكد إنه سليم، أو احفظه PDF وارفعه.', 'We couldn\'t read the file. Make sure it isn\'t damaged, or save it as PDF.'));
  }
}

export function removeImage(source, i) {
  const items = source.items.slice();
  const [gone] = items.splice(i, 1);
  if (gone) URL.revokeObjectURL(gone.url);
  if (!items.length) return null;
  return { ...source, items, total: items.length, name: items.length === 1 ? items[0].name : b(`${items.length} صور`, `${items.length} photos`) };
}

export function releaseSource(source) {
  if (source?.kind === 'images') source.items.forEach((it) => URL.revokeObjectURL(it.url));
}

/* ---------------------------------------------------------------- planning parts */

// How much one request should carry. Translation output is about as long as the input, so its parts are small;
// study output is shorter, so its parts are bigger (and smaller again when the student asks for a lot per page).
function sizes(task, depth) {
  if (task === 'translate') return { pages: 2, images: 1, chars: 4500 };
  if (depth === 'full') return { pages: 2, images: 2, chars: 7000 };
  if (depth === 'brief') return { pages: 4, images: 4, chars: 14000 };
  return { pages: 3, images: 3, chars: 10000 };
}

// Split text into pieces of at most `max` characters, at paragraph or sentence boundaries.
function splitText(text, max) {
  const paras = text.split(/\n{2,}/);
  const out = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const p of paras) {
    if (p.length > max) {
      push();
      let rest = p;
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf('.\n', max), rest.lastIndexOf('\n', max), rest.lastIndexOf(' ', max), Math.floor(max / 2));
        out.push(rest.slice(0, cut + 1).trim());
        rest = rest.slice(cut + 1);
      }
      cur = rest;
      continue;
    }
    if (cur && cur.length + p.length + 2 > max) push();
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  push();
  return out;
}

// A unit is one page / image / slide / text part. A chunk is a run of units sent in one request.
// Each chunk knows how to build its request pieces (lazily, so big files aren't held in memory as base64)
// and how to split itself in two when the function says a part was too long.
export function planChunks(source, { task, depth, range }) {
  const sz = sizes(task, depth);
  if (source.kind === 'pdf') {
    const from = Math.max(1, Math.min(range?.from || 1, source.pages));
    const to = Math.max(from, Math.min(range?.to || source.pages, source.pages));
    const chunks = [];
    for (let p = from; p <= to; p += sz.pages) chunks.push(pdfChunk(source, p, Math.min(to, p + sz.pages - 1)));
    return chunks;
  }
  if (source.kind === 'images') {
    const chunks = [];
    for (let i = 0; i < source.items.length; i += sz.images) chunks.push(imageChunk(source, i + 1, Math.min(source.items.length, i + sz.images)));
    return chunks;
  }
  if (source.kind === 'slides') {
    const chunks = [];
    let cur = [];
    let len = 0;
    for (const u of source.units) {
      if (cur.length && len + u.text.length > sz.chars) { chunks.push(slideChunk(source, cur)); cur = []; len = 0; }
      cur.push(u);
      len += u.text.length + 20;
    }
    if (cur.length) chunks.push(slideChunk(source, cur));
    return chunks;
  }
  const parts = splitText(source.text, sz.chars);
  return parts.map((t, i) => textChunk(t, i + 1, parts.length));
}

function pdfChunk(source, first, last) {
  const chunk = {
    numbering: 'page', start: first, count: last - first + 1, total: source.pages,
    label: first === last ? b(`صفحة ${first}`, `Page ${first}`) : b(`الصفحات ${iso(`${first}–${last}`)}`, `Pages ${first}–${last}`),
    async load() {
      const res = await pdfPieces(source, first, last);
      // Scanned pages can be heavy: send fewer pages per request instead of one huge upload.
      if (res.bytes > TARGET_BYTES && last > first) return { split: true };
      if (res.bytes > 8.5 * 1024 * 1024) throw new FileError(b(`الصفحة ${first} كبيرة جداً. صوّرها وارفعها كصورة.`, `Page ${first} is too large. Upload a photo of it instead.`));
      return res;
    },
    split() {
      if (last === first) return null;
      const mid = first + Math.floor((last - first) / 2);
      return [pdfChunk(source, first, mid), pdfChunk(source, mid + 1, last)];
    },
  };
  return chunk;
}

function imageChunk(source, first, last) {
  return {
    numbering: 'image', start: first, count: last - first + 1, total: source.items.length,
    label: first === last ? b(`صورة ${first}`, `Photo ${first}`) : b(`الصور ${iso(`${first}–${last}`)}`, `Photos ${first}–${last}`),
    async load() {
      const pieces = [];
      let bytes = 0;
      for (let i = first; i <= last; i++) {
        const it = source.items[i - 1];
        bytes += it.blob.size;
        pieces.push({ kind: 'image', media: 'image/jpeg', data: toBase64(await it.blob.arrayBuffer()) });
      }
      if (bytes > TARGET_BYTES && last > first) return { split: true };
      return { pieces, bytes };
    },
    split() {
      if (last === first) return null;
      const mid = first + Math.floor((last - first) / 2);
      return [imageChunk(source, first, mid), imageChunk(source, mid + 1, last)];
    },
  };
}

function slideChunk(source, units) {
  const first = units[0].n;
  const last = units[units.length - 1].n;
  return {
    numbering: 'slide', start: first, count: units.length, total: source.total,
    label: first === last ? b(`شريحة ${first}`, `Slide ${first}`) : b(`الشرائح ${iso(`${first}–${last}`)}`, `Slides ${first}–${last}`),
    async load() {
      const text = units.map((u) => `--- Slide ${u.n} ---\n${u.text || '(no text)'}`).join('\n\n');
      return { pieces: [{ kind: 'text', text }], bytes: text.length };
    },
    split() {
      if (units.length < 2) return null;
      const mid = Math.ceil(units.length / 2);
      return [slideChunk(source, units.slice(0, mid)), slideChunk(source, units.slice(mid))];
    },
  };
}

function textChunk(text, n, total, sfx = ['', '']) {
  return {
    numbering: 'part', start: n, count: 1, total,
    label: b(`الجزء ${iso(`${n}${sfx[0]}`)} من ${total}`, `Part ${n}${sfx[1]} of ${total}`),
    async load() {
      const t = `--- Part ${n} ---\n${text}`;
      return { pieces: [{ kind: 'text', text: t }], bytes: t.length };
    },
    split() {
      if (text.length < 1500) return null;
      const [a, c] = splitText(text, Math.ceil(text.length / 2) + 200);
      if (!c) return null;
      return [textChunk(a, n, total, [`${sfx[0]}أ`, `${sfx[1]}a`]), textChunk(c, n, total, [`${sfx[0]}ب`, `${sfx[1]}b`])];
    },
  };
}
