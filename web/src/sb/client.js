import { SUPABASE_URL, SUPABASE_KEY, LOGIN_DOMAIN } from './config';
import { b } from './bi';

const STORAGE_SLOT = 'ashur-bio-session';
const NET_MSG = b('تعذّر الاتصال. تأكد من الإنترنت وحاول مرة ثانية.', 'Can\'t connect. Check your internet and try again.');
const SERVER_MSG = b('صار خطأ بالخادم. حاول مرة ثانية.', 'Server error. Please try again.');
const EXPIRED_MSG = b('انتهت الجلسة. سجّل دخول مرة ثانية.', 'Your session expired. Please sign in again.');

export class ApiError extends Error {
  constructor(message, status = 0, code = '') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const LAST_USER_SLOT = 'ashur-bio-last-user';

function readStored() {
  try { return JSON.parse(localStorage.getItem(STORAGE_SLOT) || 'null'); } catch { return null; }
}

// Ask the browser not to evict our storage (keeps the student signed in on phones).
function keepStorage() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* ignore */ }
}

let session = readStored();
if (session) keepStorage();

const listeners = new Set();
export function onSessionChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const getSession = () => session;
export function getLastUsername() {
  try { return localStorage.getItem(LAST_USER_SLOT) || ''; } catch { return ''; }
}

function setSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(STORAGE_SLOT, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_SLOT);
  } catch { /* storage blocked: session lives in memory only */ }
  listeners.forEach((fn) => fn(s));
}

// Another open tab refreshed or signed out: follow it instead of fighting over the refresh token.
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_SLOT) return;
    session = readStored();
    listeners.forEach((fn) => fn(session));
  });
} catch { /* no window */ }

async function readJson(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function storeTokens(j) {
  setSession({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
    user_id: j.user?.id || session?.user_id || null,
  });
}

async function safeFetch(url, init) {
  try { return await fetch(url, init); } catch { throw new ApiError(NET_MSG, 0, 'network'); }
}

export async function signIn(username, pin) {
  const email = `${username.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
  const res = await safeFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pin }),
  });
  const j = await readJson(res);
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) throw new ApiError(b('اسم المستخدم أو الرمز غير صحيح.', 'Wrong username or PIN.'), res.status, 'invalid_credentials');
    if (res.status === 429) throw new ApiError(b('محاولات كثيرة. انتظر شوية وحاول مرة ثانية.', 'Too many attempts. Wait a moment and try again.'), 429, 'rate_limited');
    throw new ApiError(SERVER_MSG, res.status, 'server');
  }
  storeTokens(j);
  try { localStorage.setItem(LAST_USER_SLOT, username.trim().toLowerCase()); } catch { /* ignore */ }
  keepStorage();
  return session;
}

// One refresh at a time, across tabs too (Web Locks). A session is only dropped when the server
// definitively rejects the refresh token and no other tab already holds a newer one.
async function refreshOnce() {
  const stored = readStored();
  if (stored && stored.refresh_token && (!session || stored.refresh_token !== session.refresh_token)) {
    session = stored;
    if (stored.expires_at - 60 > Date.now() / 1000) return; // another tab just refreshed
  }
  if (!session?.refresh_token) { setSession(null); throw new ApiError(EXPIRED_MSG, 401, 'session_expired'); }
  const used = session.refresh_token;
  const res = await safeFetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: used }),
  });
  const j = await readJson(res);
  if (res.ok) { storeTokens(j); return; }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const again = readStored();
    if (again && again.refresh_token && again.refresh_token !== used) { session = again; return; }
    setSession(null);
    throw new ApiError(EXPIRED_MSG, 401, 'session_expired');
  }
  throw new ApiError(SERVER_MSG, res.status, 'server'); // 429/5xx: keep the session, try again later
}

let refreshing = null;
async function refresh() {
  if (!refreshing) {
    const run = () => refreshOnce();
    const p = (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request)
      ? navigator.locks.request('ashur-bio-refresh', run)
      : run();
    refreshing = Promise.resolve(p).finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 < Date.now() / 1000) await refresh();
  return session?.access_token || null;
}

export async function signOut() {
  const current = session?.access_token;
  setSession(null);
  if (current) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${current}` },
    }).catch(() => {});
  }
}

const ERROR_TEXT = {
  not_allowed: b('ما عندك صلاحية لهذا الإجراء.', 'You don\'t have permission to do this.'),
  cannot_change_self: b('ما تكدر تسوي هذا الإجراء على حسابك.', 'You can\'t do this to your own account.'),
  not_found: b('العنصر غير موجود. حدّث الصفحة.', 'Item not found. Refresh the page.'),
  bad_code: b('رمز القسم لازم يكون من 4 إلى 20 حرف (A-Z و 0-9 و -).', 'The department code must be 4–20 characters (A–Z, 0–9 and -).'),
  bad_role: b('دور غير صالح.', 'Invalid role.'),
  bad_status: b('حالة غير صالحة.', 'Invalid status.'),
};

function describe(j, status) {
  const msg = (j && (j.message || j.msg || j.error_description)) || '';
  if (ERROR_TEXT[msg]) return ERROR_TEXT[msg];
  const code = j?.code;
  if (code === '42501' || status === 403) return ERROR_TEXT.not_allowed;
  if (code === '23505') return b('هذا العنصر موجود مسبقاً.', 'This item already exists.');
  if (code === '23503') return b('المادة المرتبطة غير موجودة. حدّث الصفحة.', 'The linked subject no longer exists. Refresh the page.');
  if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return b('بعض البيانات غير صحيحة. راجع الحقول.', 'Some of the data is invalid. Check the fields.');
  if (status === 429) return b('طلبات كثيرة. انتظر شوية.', 'Too many requests. Please wait a moment.');
  return b('صار خطأ. حاول مرة ثانية.', 'Something went wrong. Please try again.');
}

export async function request(path, { method = 'GET', body, headers = {}, auth = true, retried = false } = {}) {
  const h = { apikey: SUPABASE_KEY, ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth) {
    const t = await accessToken();
    if (t) h.Authorization = `Bearer ${t}`;
  }
  const res = await safeFetch(`${SUPABASE_URL}${path}`, {
    method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await readJson(res);
  if (res.status === 401 && auth && session && !retried) {
    await refresh();
    return request(path, { method, body, headers, auth, retried: true });
  }
  if (!res.ok) throw new ApiError(describe(j, res.status), res.status, j?.code || '');
  return j;
}

const enc = encodeURIComponent;
function mustAffect(rows) {
  if (Array.isArray(rows) && rows.length === 0) throw new ApiError(ERROR_TEXT.not_allowed, 403, 'no_rows');
  return rows;
}

export const db = {
  select: (table, query = 'select=*') => request(`/rest/v1/${table}?${query}`),
  insert: (table, row) => request(`/rest/v1/${table}`, { method: 'POST', body: row, headers: { Prefer: 'return=representation' } }).then(mustAffect),
  update: (table, id, patch) => request(`/rest/v1/${table}?id=eq.${enc(id)}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' } }).then(mustAffect),
  remove: (table, id) => request(`/rest/v1/${table}?id=eq.${enc(id)}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }).then(mustAffect),
  upsert: (table, row, onConflict) => request(`/rest/v1/${table}?on_conflict=${enc(onConflict)}`, {
    method: 'POST', body: row, headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
  }),
  rpc: (fn, args = {}) => request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args }),
};

// Signed-in call to an edge function that streams its answer (study-ai). Returns the raw Response so the
// caller can read the stream; `body` is an already-serialised JSON string (it can be several MB).
export async function postStream(name, body, signal) {
  const run = async () => {
    const t = await accessToken(); // may throw session_expired: let it through as is
    const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (t) h.Authorization = `Bearer ${t}`;
    try {
      return await fetch(`${SUPABASE_URL}/functions/v1/${name}`, { method: 'POST', headers: h, body, signal });
    } catch (e) {
      if (e?.name === 'AbortError') throw e;
      throw new ApiError(NET_MSG, 0, 'network');
    }
  };
  let res = await run();
  if (res.status === 401 && session) {
    await res.body?.cancel();
    await refresh();
    res = await run();
  }
  return res;
}

// Public edge functions (register, reset-pin). They always answer {ok, message}.
export async function callFunction(name, body) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: NET_MSG };
  }
  const j = await readJson(res);
  if (j && typeof j.message === 'string') {
    // The edge functions send Arabic in `message` and English in `message_en`.
    return { ...j, message: j.message_en ? b(j.message, j.message_en) : j.message };
  }
  return { ok: false, message: SERVER_MSG };
}
