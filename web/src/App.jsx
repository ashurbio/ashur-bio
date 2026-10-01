import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Home as HomeIcon, CalendarDays, Megaphone, ClipboardList, BookOpen, UserRound, ShieldCheck, CircleSlash2, MoreHorizontal, WifiOff, Languages } from 'lucide-react';
import { StoreProvider, useStore } from '@/sb/store';
import { EditorProvider } from '@/sb/editor';
import AuthScreen from '@/sb/auth';
import AdminPanel from '@/sb/admin';
import { Home, Schedule, Announcements, Exams, Materials, Absences, Account, hasUnseenUrgent } from '@/sb/screens';
import { Backdrop, CellMark, Sheet, Skeleton, Toast } from '@/sb/ui';
import { Bi, b, flat } from '@/sb/bi';
import { ROLE_LABEL, uniBi, deptBi } from '@/sb/util';

// Loaded on first visit only (it brings the file readers and the quiz views).
const Study = lazy(() => import('@/sb/study/index.jsx'));

const TABS = [
  { id: 'home', label: b('الرئيسية', 'Home'), icon: HomeIcon, main: true },
  { id: 'schedule', label: b('الجدول', 'Schedule'), icon: CalendarDays, main: true },
  { id: 'announcements', label: b('الإعلانات', 'Announcements'), nav: b('الإعلانات', 'Notices'), icon: Megaphone, main: true },
  { id: 'exams', label: b('الامتحانات', 'Exams'), icon: ClipboardList, main: true },
  { id: 'materials', label: b('المحاضرات والملفات', 'Lectures & files'), icon: BookOpen },
  { id: 'study', label: b('المترجم والملخّص', 'Translate & summarise'), icon: Languages },
  { id: 'absences', label: b('غياباتي', 'My absences'), icon: CircleSlash2 },
  { id: 'account', label: b('حسابي', 'My account'), icon: UserRound },
  { id: 'admin', label: b('لوحة الممثل', 'Representative panel'), icon: ShieldCheck, staff: true },
];

function readHash() {
  const h = (window.location.hash || '').replace('#', '');
  return TABS.some((t) => t.id === h) ? h : 'home';
}

const HINT_SLOT = 'ashur-bio-install-hint';

// iPhone Safari wipes a website's saved data after ~7 days without a visit; the home-screen
// version is exempt, so nudge students to install it once.
function needsInstallHint() {
  try {
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    return ios && !standalone && localStorage.getItem(HINT_SLOT) !== '1';
  } catch { return false; }
}

function Shell() {
  const { profile, settings, isStaff, data, netError, retry, toast, phase } = useStore();
  const [tab, setTab] = useState(readHash());
  const [more, setMore] = useState(false);
  const [hint, setHint] = useState(needsInstallHint);
  const closeHint = () => {
    setHint(false);
    try { localStorage.setItem(HINT_SLOT, '1'); } catch { /* ignore */ }
  };

  useEffect(() => {
    const onHash = () => setTab(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id) => {
    setMore(false);
    if (id === tab) { window.scrollTo({ top: 0 }); return; }
    window.location.hash = id;
    setTab(id);
    window.scrollTo({ top: 0 });
  };

  const visible = TABS.filter((t) => !t.staff || isStaff);
  const current = tab === 'admin' && !isStaff ? 'home' : tab;
  const urgentDot = current !== 'announcements' && hasUnseenUrgent(data.announcements);
  const deptLine = deptBi(settings);

  const View = { home: Home, schedule: Schedule, announcements: Announcements, exams: Exams, materials: Materials, study: Study, absences: Absences, account: Account, admin: AdminPanel }[current] || Home;

  if (phase === 'loading' && !profile) {
    return <div className="boot"><CellMark size={52} /><div className="spinner" role="status" aria-label="جارٍ التحميل / Loading" /></div>;
  }

  const moreActive = !TABS.find((t) => t.id === current)?.main;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <CellMark size={40} />
          <div className="min0">
            <div className="uni"><Bi t={uniBi(settings)} /></div>
            <div className="dept"><Bi t={deptLine} /></div>
          </div>
        </div>
        <nav className="side-nav" aria-label="أقسام التطبيق / App sections">
          {visible.map((t) => (
            <button key={t.id} type="button" className="tab" aria-current={current === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <t.icon size={19} aria-hidden="true" /><Bi t={t.label} />
              {t.id === 'announcements' && urgentDot ? <span className="dot" aria-label="إعلان عاجل جديد / New urgent announcement" /> : null}
            </button>
          ))}
        </nav>
        {profile ? (
          <button type="button" className="whoami" onClick={() => go('account')}>
            <span className="avatar" aria-hidden="true">{(profile.full_name || '?').trim().charAt(0)}</span>
            <span className="min0"><span className="n">{profile.full_name}</span><span className={`role${isStaff ? ' admin' : ''}`}><Bi t={ROLE_LABEL[profile.role]} inline /></span></span>
          </button>
        ) : null}
      </aside>

      <header className="topbar">
        <CellMark size={32} />
        <div className="min0">
          <div className="uni"><Bi t={uniBi(settings)} /></div>
        </div>
        {profile ? <span className={`role${isStaff ? ' admin' : ''}`}><Bi t={ROLE_LABEL[profile.role]} inline /></span> : null}
      </header>

      <main className="main">
        <div className="wrap">
          {netError ? (
            <div className="banner" role="alert">
              <span><WifiOff size={16} aria-hidden="true" /> <Bi t={netError} /></span>
              <button type="button" onClick={retry}><Bi t={b('إعادة المحاولة', 'Retry')} /></button>
            </div>
          ) : null}
          {hint ? (
            <div className="banner" role="note" style={{ background: 'var(--accent-soft)', color: 'var(--ink)', borderColor: 'var(--line)' }}>
              <span><Bi t={b('حتى يبقى تسجيل دخولك محفوظ: افتح الرابط من Safari (مو من داخل تلغرام أو واتساب)، اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»، وبعدها افتح التطبيق من الأيقونة وسجّل دخول مرة وحدة.', 'To stay signed in: open this link in Safari (not inside Telegram or WhatsApp), tap Share, then “Add to Home Screen”, then open the app from its icon and sign in once.')} /></span>
              <button type="button" style={{ color: 'var(--accent)' }} onClick={closeHint}><Bi t={b('تمام', 'Got it')} /></button>
            </div>
          ) : null}
          <Suspense fallback={<div className="panel"><Skeleton /></div>}><View go={go} /></Suspense>
        </div>
      </main>

      <nav className="bottom-nav" aria-label="التنقل / Navigation">
        {TABS.filter((t) => t.main).map((t) => (
          <button key={t.id} type="button" aria-current={current === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
            <span className="ico"><t.icon size={21} aria-hidden="true" />{t.id === 'announcements' && urgentDot ? <span className="dot" /> : null}</span>
            <Bi t={t.nav || t.label} />
          </button>
        ))}
        <button type="button" aria-current={moreActive ? 'page' : undefined} onClick={() => setMore(true)} aria-haspopup="dialog">
          <span className="ico"><MoreHorizontal size={21} aria-hidden="true" /></span><Bi t={b('المزيد', 'More')} />
        </button>
      </nav>

      <Sheet open={more} title={b('المزيد', 'More')} onClose={() => setMore(false)}>
        <div className="more-list">
          {visible.filter((t) => !t.main).map((t) => (
            <button key={t.id} type="button" className="more-item" aria-current={current === t.id ? 'page' : undefined} onClick={() => go(t.id)}>
              <t.icon size={20} aria-hidden="true" /><Bi t={t.label} />
            </button>
          ))}
        </div>
      </Sheet>

      <Toast text={toast} />
    </div>
  );
}

function Root() {
  const { session, toast } = useStore();
  if (!session) return <><Backdrop /><AuthScreen /><Toast text={toast} /></>;
  return <><Backdrop /><EditorProvider><Shell /></EditorProvider></>;
}

export default function App() {
  return <StoreProvider><Root /></StoreProvider>;
}
