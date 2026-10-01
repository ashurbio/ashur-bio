import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { b } from './bi';
import { db, getSession, onSessionChange, signIn as apiSignIn, signOut as apiSignOut, ApiError } from './client';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const EMPTY = { subjects: [], schedule: [], announcements: [], exams: [], materials: [], absences: {} };
const DEFAULT_SETTINGS = {
  university: 'جامعة آشور', department: 'قسم علوم الحياة', stage: '', section: '',
  rep_name: '', rep_contact: '', absence_limit: 6,
};

export function StoreProvider({ children }) {
  const [session, setSession] = useState(getSession());
  const [profile, setProfile] = useState(null);
  const [phase, setPhase] = useState(getSession() ? 'loading' : 'anon'); // anon | loading | ready
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [netError, setNetError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const [toast, setToast] = useState('');
  const toastTimer = useRef(0);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3400);
  }, []);

  useEffect(() => onSessionChange((s) => {
    setSession(s);
    if (!s) { setProfile(null); setPhase('anon'); setData(EMPTY); setLoaded(false); }
  }), []);

  const loadSettings = useCallback(async () => {
    try {
      const rows = await db.select('settings', 'select=*&id=eq.1');
      if (rows && rows[0]) setSettings({ ...DEFAULT_SETTINGS, ...rows[0] });
    } catch { /* settings are cosmetic; keep defaults */ }
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [subjects, schedule, announcements, exams, materials, absences] = await Promise.all([
        db.select('subjects', 'select=*&order=sort.asc,name.asc'),
        db.select('schedule', 'select=*&order=day.asc,start_time.asc'),
        db.select('announcements', 'select=*&order=pinned.desc,created_at.desc&limit=300'),
        db.select('exams', 'select=*&order=exam_date.asc,exam_time.asc.nullslast'),
        db.select('materials', 'select=*&order=created_at.desc&limit=500'),
        db.select('absences', 'select=subject_id,count'),
      ]);
      const abs = {};
      (absences || []).forEach((r) => { abs[r.subject_id] = r.count; });
      setData({ subjects: subjects || [], schedule: schedule || [], announcements: announcements || [], exams: exams || [], materials: materials || [], absences: abs });
      setLoaded(true);
      setNetError('');
      loadSettings();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'network') setNetError(e.message);
      else if (e instanceof ApiError && e.status === 401) { /* session cleared by client */ }
      else setNetError(e.message || b('تعذّر تحميل البيانات.', 'Couldn\'t load the data.'));
    }
  }, [loadSettings]);

  const loadProfile = useCallback(async () => {
    const s = getSession();
    if (!s) return null;
    try {
      const rows = await db.select('profiles', `select=*&id=eq.${s.user_id}`);
      const p = rows && rows[0];
      if (!p) { apiSignOut(); setAuthNotice(b('ما لكينا حسابك. تواصل مع ممثل المرحلة.', 'We couldn\'t find your account. Contact your class representative.')); return null; }
      if (p.status === 'disabled') { apiSignOut(); setAuthNotice(b('حسابك موقوف. راجع ممثل المرحلة.', 'Your account is suspended. Contact your class representative.')); return null; }
      setProfile(p);
      return p;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'network') setNetError(e.message);
      return null;
    }
  }, []);

  // Boot and react to sign-in.
  useEffect(() => {
    loadSettings();
    if (!session) return;
    let cancelled = false;
    (async () => {
      setPhase('loading');
      const p = await loadProfile();
      if (cancelled) return;
      if (p) { await loadAll(); if (!cancelled) setPhase('ready'); }
      else if (getSession()) setPhase('ready'); // network trouble: show shell with retry banner
    })();
    return () => { cancelled = true; };
  }, [session?.user_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep data fresh: poll every 60s while visible, and on return to the tab.
  useEffect(() => {
    if (!session) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') loadAll(); };
    const id = setInterval(tick, 60000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [session?.user_id, loadAll]); // eslint-disable-line react-hooks/exhaustive-deps

  const signIn = useCallback(async (username, pin) => {
    setAuthNotice('');
    await apiSignIn(username, pin);
  }, []);
  const signOut = useCallback(() => { apiSignOut(); }, []);

  const retry = useCallback(async () => {
    setNetError('');
    if (!profile) { const p = await loadProfile(); if (!p) return; }
    await loadAll();
  }, [profile, loadProfile, loadAll]);

  const isStaff = !!profile && (profile.role === 'rep' || profile.role === 'owner') && profile.status === 'active';
  const isOwner = !!profile && profile.role === 'owner';

  const value = useMemo(() => ({
    session, profile, setProfile, phase, data, setData, loaded, settings, setSettings,
    netError, retry, authNotice, setAuthNotice, toast, notify,
    signIn, signOut, reload: loadAll, isStaff, isOwner,
  }), [session, profile, phase, data, loaded, settings, netError, retry, authNotice, toast, notify, signIn, signOut, loadAll, isStaff, isOwner]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
