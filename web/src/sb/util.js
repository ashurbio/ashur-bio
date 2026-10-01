import { b } from './bi';

export const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayBi = (d) => b(DAYS[d], DAYS_EN[d]);
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4]; // Saturday → Thursday
export const SWATCHES = ['#1F8A6B', '#2F6FB0', '#8A4FB5', '#C0572F', '#B8860B', '#C23B6B', '#3C8C9E', '#6B7F2A'];

// These Arabic values are what the database stores (check constraints), so they never change.
// Labels shown to the user are bilingual.
export const EXAM_KINDS = ['يومي', 'شهري', 'فصلي', 'نهائي', 'عملي'];
export const MAT_KINDS = ['محاضرة', 'ملزمة', 'سلايدات', 'تقرير', 'أسئلة', 'أخرى'];
const EN = {
  type: { نظري: 'Theory', عملي: 'Lab' },
  exam: { يومي: 'Quiz', شهري: 'Monthly', فصلي: 'Term', نهائي: 'Final', عملي: 'Practical' },
  mat: { محاضرة: 'Lecture', ملزمة: 'Handout', سلايدات: 'Slides', تقرير: 'Report', أسئلة: 'Questions', أخرى: 'Other' },
};
export const examTitleBi = (v) => b(`امتحان ${v}`, v === 'يومي' ? 'Quiz' : `${EN.exam[v]} exam`);
export const kindBi = (group, v) => (EN[group][v] ? b(v, EN[group][v]) : v);

export const ROLE_LABEL = {
  owner: b('المشرف', 'Owner'),
  rep: b('الممثل', 'Representative'),
  student: b('طالب', 'Student'),
};

// Names the rep hasn't customised get an English line; anything they typed stays as typed.
const DEFAULT_UNI = 'جامعة آشور';
const DEFAULT_DEPT = 'قسم علوم الحياة';
export const uniBi = (s) => ((!s.university || s.university === DEFAULT_UNI) ? b(DEFAULT_UNI, 'Ashur University') : s.university);
export function deptBi(s, withSection = true) {
  const parts = [s.department, s.stage, withSection ? s.section : ''].filter(Boolean);
  const ar = parts.join('، ');
  return s.department === DEFAULT_DEPT ? b(ar, 'Department of Life Sciences') : ar;
}

const TZ = 'Asia/Baghdad';
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Current date/time in Baghdad regardless of the device's time zone.
export function nowBaghdad() {
  const parts = partsFmt.formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const h = Number(g('hour')) % 24;
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, dow: WD[g('weekday')], minutes: h * 60 + Number(g('minute')) };
}

export function toMin(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}
export const hhmm = (t) => (t ? String(t).slice(0, 5) : '');
export function t12(t) {
  if (!t) return '';
  let [h, m] = String(t).split(':').map(Number);
  const p = h < 12 ? 'ص' : 'م';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${p}`;
}

function ymdUTC(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function daysUntil(ymd) {
  if (!ymd) return null;
  return Math.round((ymdUTC(ymd) - ymdUTC(nowBaghdad().ymd)) / 86400000);
}
const dateOpts = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
let longFmt;
try { longFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', dateOpts); } catch { longFmt = new Intl.DateTimeFormat('ar', dateOpts); }
let longFmtEn;
try { longFmtEn = new Intl.DateTimeFormat('en-GB', dateOpts); } catch { longFmtEn = new Intl.DateTimeFormat('en', dateOpts); }
export const fmtDate = (ymd) => (ymd ? longFmt.format(new Date(ymdUTC(ymd))) : '');
export const fmtDateEn = (ymd) => (ymd ? longFmtEn.format(new Date(ymdUTC(ymd))) : '');
export const dateBi = (ymd) => (ymd ? b(fmtDate(ymd), fmtDateEn(ymd)) : '');
export const todayBi = () => dateBi(nowBaghdad().ymd);

export function countdownBi(n) {
  if (n == null) return '';
  if (n < 0) return b('انتهى', 'Finished');
  if (n === 0) return b('اليوم', 'Today');
  if (n === 1) return b('غداً', 'Tomorrow');
  if (n === 2) return b('بعد يومين', 'In 2 days');
  if (n <= 10) return b(`بعد ${n} أيام`, `In ${n} days`);
  return b(`بعد ${n} يوماً`, `In ${n} days`);
}
export function dayUnitBi(n) {
  return b(n >= 2 && n <= 10 ? 'أيام' : 'يوم', n === 1 ? 'day' : 'days');
}

let rtf;
let rtfEn;
try { rtf = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' }); } catch { rtf = null; }
try { rtfEn = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); } catch { rtfEn = null; }
export function agoBi(iso) {
  if (!iso) return '';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (!rtf || !rtfEn || a < 60) return b('الآن', 'Just now');
  const both = (v, unit) => b(rtf.format(v, unit), rtfEn.format(v, unit));
  if (a < 3600) return both(Math.round(s / 60), 'minute');
  if (a < 86400) return both(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return both(Math.round(s / 86400), 'day');
  return dateBi(new Date(iso).toISOString().slice(0, 10));
}

export function safeUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : '';
  } catch { return ''; }
}

export const firstName = (full) => (full || '').trim().split(/\s+/)[0] || '';

export function lsGet(k, fallback) {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
export function lsSet(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}
