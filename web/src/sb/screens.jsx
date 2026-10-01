import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, ExternalLink, MapPin, ChevronDown, Minus, LogOut, Languages } from 'lucide-react';
import { useStore } from './store';
import { useEditor } from './editor';
import { db, getSession } from './client';
import { Dot, Empty, Skeleton, FormSheet } from './ui';
import { b, Bi, flat } from './bi';
import { getMotion, setMotion } from './motion';
import {
  DAYS, WEEK_ORDER, ROLE_LABEL, dayBi, kindBi, nowBaghdad, toMin, t12, daysUntil, dateBi, todayBi,
  countdownBi, dayUnitBi, examTitleBi, agoBi, safeUrl, firstName, lsGet, lsSet,
} from './util';

const DELETED = b('مادة محذوفة', 'Deleted subject');

function useSubjects() {
  const { data } = useStore();
  return useMemo(() => {
    const m = {};
    data.subjects.forEach((s) => { m[s.id] = s; });
    return m;
  }, [data.subjects]);
}

function useNow(ms = 30000) {
  const [now, setNow] = useState(nowBaghdad());
  useEffect(() => { const id = setInterval(() => setNow(nowBaghdad()), ms); return () => clearInterval(id); }, [ms]);
  return now;
}

function AddButton({ type, label }) {
  const { isStaff } = useStore();
  const edit = useEditor();
  if (!isStaff) return null;
  return <button className="btn" type="button" onClick={() => edit(type)}><Plus size={16} /><Bi t={label} /></button>;
}
function EditButton({ type, item }) {
  const { isStaff } = useStore();
  const edit = useEditor();
  if (!isStaff) return null;
  return <button className="icon-btn" type="button" onClick={() => edit(type, item)} aria-label="تعديل / Edit"><Pencil size={16} /></button>;
}

function SecHead({ title, sub, children }) {
  return (
    <div className="sec-head">
      <div><h1><Bi t={title} /></h1>{sub ? <p><Bi t={sub} /></p> : null}</div>
      {children}
    </div>
  );
}

/* ---------------- lecture row ---------------- */
function LectureRow({ l, subj, isToday, now }) {
  const a = toMin(l.start_time); const b2 = toMin(l.end_time);
  const isNow = isToday && now.minutes >= a && now.minutes < b2;
  const isPast = isToday && now.minutes >= b2;
  return (
    <div className={`lec${isNow ? ' is-now' : ''}${isPast ? ' is-past' : ''}`}>
      <div className="time num">{t12(l.start_time)}<small>{t12(l.end_time)}</small></div>
      <div className="lec-main">
        <div className="title">
          <Dot color={subj?.color} />
          <span>{subj ? subj.name : <Bi t={DELETED} inline />}</span>
          <span className={`chip${l.type === 'عملي' ? ' lab' : ''}`}><Bi t={kindBi('type', l.type)} inline /></span>
          {isNow ? <span className="chip now"><Bi t={b('الآن', 'Now')} inline /></span> : null}
        </div>
        <div className="meta">
          {l.room ? <span><MapPin size={13} />{l.room}</span> : null}
          {subj?.teacher ? <span>{subj.teacher}</span> : null}
          {subj?.code ? <span className="code">{subj.code}</span> : null}
          {l.note ? <span>{l.note}</span> : null}
        </div>
      </div>
      <EditButton type="schedule" item={l} />
    </div>
  );
}

/* ---------------- today ribbon (signature element) ---------------- */
function TodayRibbon({ lectures, subjects, now }) {
  const [sel, setSel] = useState(null);
  const start = Math.min(...lectures.map((l) => toMin(l.start_time)));
  const end = Math.max(...lectures.map((l) => toMin(l.end_time)));
  const from = Math.floor(start / 60) * 60;
  const to = Math.ceil(end / 60) * 60;
  const span = Math.max(to - from, 60);
  const pos = (m) => ((m - from) / span) * 100;
  const hours = [];
  for (let h = from; h <= to; h += 60) hours.push(h);
  const showNow = now.minutes >= from && now.minutes <= to;
  const current = lectures.find((l) => now.minutes >= toMin(l.start_time) && now.minutes < toMin(l.end_time));
  const next = lectures.find((l) => toMin(l.start_time) > now.minutes);
  const picked = lectures.find((l) => l.id === sel);
  const nm = (l) => subjects[l.subject_id]?.name;

  let status;
  if (current) {
    status = <Bi ar={<>هسه: <b>{nm(current)}</b> لحد {t12(current.end_time)}</>} en={<>Now: <b>{nm(current)}</b> until {t12(current.end_time)}</>} />;
  } else if (next) {
    const mins = toMin(next.start_time) - now.minutes;
    const h = Math.floor(mins / 60); const m = mins % 60;
    const ar = mins < 60 ? `${mins} دقيقة` : `${h} س${m ? ` و${m} د` : ''}`;
    const en = mins < 60 ? `${mins} min` : `${h} h${m ? ` ${m} min` : ''}`;
    status = <Bi ar={<>المحاضرة الجاية: <b>{nm(next)}</b> بعد {ar}</>} en={<>Next lecture: <b>{nm(next)}</b> in {en}</>} />;
  } else status = <Bi t={b('خلص دوام اليوم.', 'Classes are over for today.')} />;

  return (
    <div className="ribbon-wrap">
      <p className="ribbon-status">{status}</p>
      <div className="ribbon" role="group" aria-label="محاضرات اليوم على خط الوقت / Today's lectures on a timeline">
        <div className="ribbon-track" style={{ minWidth: `${Math.max(lectures.length * 118, 280)}px` }}>
          {hours.map((h) => (
            <span key={h} className="tick" style={{ insetInlineStart: `${pos(h)}%` }}>
              <i>{t12(`${String(Math.floor(h / 60)).padStart(2, '0')}:00`).replace(':00', '')}</i>
            </span>
          ))}
          {lectures.map((l) => {
            const a = toMin(l.start_time); const e = toMin(l.end_time);
            const s = subjects[l.subject_id];
            const state = now.minutes >= e ? 'past' : now.minutes >= a ? 'now' : 'next';
            return (
              <button
                key={l.id}
                type="button"
                className={`rb-block ${state}${sel === l.id ? ' sel' : ''}`}
                style={{ insetInlineStart: `${pos(a)}%`, width: `${pos(e) - pos(a)}%`, '--c': s?.color || 'var(--accent)' }}
                onClick={() => setSel(sel === l.id ? null : l.id)}
                aria-label={`${s?.name || ''} ${t12(l.start_time)} - ${t12(l.end_time)}`}
              >
                <span>{s?.name || '—'}</span>
              </button>
            );
          })}
          {showNow ? <span className="nowline" style={{ insetInlineStart: `${pos(now.minutes)}%` }} aria-hidden="true" /> : null}
        </div>
      </div>
      {picked ? (
        <div className="ribbon-detail">
          <Dot color={subjects[picked.subject_id]?.color} />
          <b>{subjects[picked.subject_id]?.name}</b>
          <span>{t12(picked.start_time)} – {t12(picked.end_time)}</span>
          <span className={`chip${picked.type === 'عملي' ? ' lab' : ''}`}><Bi t={kindBi('type', picked.type)} inline /></span>
          {picked.room ? <span><MapPin size={13} />{picked.room}</span> : null}
          {subjects[picked.subject_id]?.teacher ? <span>{subjects[picked.subject_id].teacher}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function sortedAnnouncements(list) {
  return list.slice().sort((a, c) => (c.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(c.created_at) - new Date(a.created_at));
}

/* ---------------- Home ---------------- */
function SetupChecklist({ go }) {
  const { data, settings, isStaff } = useStore();
  const edit = useEditor();
  if (!isStaff) return null;
  const steps = [
    { done: !!settings.stage, label: b('اكتب معلومات المرحلة والتواصل', 'Fill in the class and contact details'), act: () => go('admin'), btn: b('لوحة الممثل', 'Rep panel') },
    { done: data.subjects.length > 0, label: b('أضف المواد الدراسية', 'Add the subjects'), act: () => edit('subject'), btn: b('أضف مادة', 'Add subject') },
    { done: data.schedule.length > 0, label: b('أدخل جدول الدوام الأسبوعي', 'Enter the weekly timetable'), act: () => edit('schedule'), btn: b('أضف محاضرة', 'Add lecture') },
    { done: data.announcements.length > 0, label: b('انشر أول إعلان للطلاب', 'Post the first announcement'), act: () => edit('announcement'), btn: b('أضف إعلان', 'Add notice') },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <article className="panel">
      <h2><Bi t={b('تجهيز التطبيق', 'Set up the app')} /></h2>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="l"><span className="ck">{s.done ? '✓' : ''}</span><Bi t={s.label} /></span>
            {s.done ? null : <button className="btn ghost sm" type="button" onClick={s.act}><Bi t={s.btn} /></button>}
          </li>
        ))}
      </ol>
    </article>
  );
}

export function Home({ go }) {
  const { profile, data, loaded, settings, isStaff } = useStore();
  const subjects = useSubjects();
  const now = useNow();
  const todays = data.schedule.filter((l) => l.day === now.dow).sort((x, y) => toMin(x.start_time) - toMin(y.start_time));
  const upcoming = data.exams.filter((e) => daysUntil(e.exam_date) >= 0).sort((x, y) => x.exam_date.localeCompare(y.exam_date));
  const next = upcoming[0];
  const anns = sortedAnnouncements(data.announcements).slice(0, 3);
  const first = firstName(profile?.full_name);

  let todayBody;
  if (!loaded) todayBody = <Skeleton />;
  else if (!data.schedule.length) {
    todayBody = <Empty title={b('الجدول ما انضاف بعد', 'The timetable hasn\'t been added yet')}>{isStaff ? b('أضف محاضرات الأسبوع حتى تطلع هنا.', 'Add the week\'s lectures and they will show up here.') : b('يضيف الممثل جدول الأسبوع هنا.', 'The representative will add the weekly timetable here.')}</Empty>;
  } else if (!todays.length) {
    todayBody = <Empty title={b('ماكو دوام اليوم', 'No classes today')}>{now.dow === 5 || now.dow === 6 ? b('عطلة نهاية الأسبوع.', 'Weekend.') : b('ما مسجلة محاضرات لهذا اليوم.', 'No lectures are scheduled for today.')}</Empty>;
  } else todayBody = <TodayRibbon lectures={todays} subjects={subjects} now={now} />;

  let examBody;
  if (!loaded) examBody = <Skeleton />;
  else if (!next) examBody = <Empty title={b('ماكو امتحانات قادمة', 'No upcoming exams')}>{b('أقرب امتحان يطلع هنا مع عدّاد الأيام.', 'The nearest exam shows up here with a day countdown.')}</Empty>;
  else {
    const n = daysUntil(next.exam_date);
    const sname = subjects[next.subject_id]?.name;
    examBody = (
      <>
        <div className="exam-feature">
          <div className={`count${n <= 2 ? ' soon' : ''}`}>
            <b className="num">{n === 0 ? <Bi t={b('اليوم', 'Today')} /> : n}</b>
            {n === 0 ? null : <Bi t={dayUnitBi(n)} />}
          </div>
          <div className="min0">
            <div className="t"><Dot color={subjects[next.subject_id]?.color} /> {sname || <Bi t={DELETED} />}</div>
            <div className="m"><Bi t={examTitleBi(next.kind)} /></div>
            <div className="m"><Bi t={dateBi(next.exam_date)} />{next.exam_time ? <span className="num"> {t12(next.exam_time)}</span> : null}</div>
            {next.room ? <div className="m">{next.room}</div> : null}
          </div>
        </div>
        {upcoming.length > 1 ? (
          <p className="note">
            <Bi
              ar={`و${upcoming.length - 1} ${upcoming.length - 1 === 1 ? 'امتحان آخر قادم' : 'امتحانات أخرى قادمة'}.`}
              en={`${upcoming.length - 1} more upcoming ${upcoming.length - 1 === 1 ? 'exam' : 'exams'}.`}
            />
          </p>
        ) : null}
      </>
    );
  }

  const nExam = next ? daysUntil(next.exam_date) : null;
  const urgentCount = data.announcements.filter((a) => a.urgent).length;

  return (
    <div className="stack-lg">
      <section className="hello hero">
        <div className="hero-copy">
          <h1><Bi ar={first ? `مرحباً، ${first}` : 'أهلاً بك'} en={first ? `Welcome, ${first}` : 'Welcome'} /></h1>
          <p><Bi t={todayBi()} /></p>
        </div>
        {loaded ? (
          <div className="hero-stats">
            <button type="button" className="stat" onClick={() => go('schedule')}>
              <b className="num">{todays.length}</b>
              <Bi t={todays.length === 1 ? b('محاضرة اليوم', 'Lecture today') : b('محاضرات اليوم', 'Lectures today')} />
            </button>
            <button type="button" className="stat" onClick={() => go('exams')}>
              <b className="num">{next ? (nExam === 0 ? <Bi t={b('اليوم', 'Today')} /> : nExam) : '—'}</b>
              <Bi t={next ? (nExam === 0 ? b('امتحان', 'Exam') : (() => { const [ua, ue] = dayUnitBi(nExam).split('\n'); return b(`${ua} للامتحان`, `${ue} to exam`); })()) : b('ماكو امتحان', 'No exam')} />
            </button>
            <button type="button" className={`stat${urgentCount ? ' hot' : ''}`} onClick={() => go('announcements')}>
              <b className="num">{urgentCount}</b><Bi t={b('إعلان عاجل', 'Urgent notices')} />
            </button>
          </div>
        ) : null}
      </section>
      <SetupChecklist go={go} />
      <div className="home-grid">
        <article className="panel span">
          <h2><Bi t={b('محاضرات اليوم', 'Today\'s lectures')} /> <button className="link" type="button" onClick={() => go('schedule')}><Bi t={b('الجدول الكامل', 'Full schedule')} inline /></button></h2>
          {todayBody}
        </article>
        <article className="panel">
          <h2><Bi t={b('أقرب امتحان', 'Next exam')} /> <button className="link" type="button" onClick={() => go('exams')}><Bi t={b('كل الامتحانات', 'All exams')} inline /></button></h2>
          {examBody}
        </article>
        <article className="panel">
          <h2><Bi t={b('آخر الإعلانات', 'Latest announcements')} /> <button className="link" type="button" onClick={() => go('announcements')}><Bi t={b('الكل', 'All')} inline /></button></h2>
          {!loaded ? <Skeleton /> : !anns.length ? <Empty title={b('ماكو إعلانات', 'No announcements')}>{b('إعلانات الممثل تطلع هنا أول بأول.', 'The representative\'s announcements appear here as soon as they\'re posted.')}</Empty> : (
            <div className="ann-mini">
              {anns.map((a) => (
                <button key={a.id} type="button" className="row" onClick={() => go('announcements')}>
                  <b>{a.urgent ? <span className="chip urgent"><Bi t={b('عاجل', 'Urgent')} inline /></span> : null}{a.title}</b>
                  <span><Bi t={agoBi(a.created_at)} inline /></span>
                </button>
              ))}
            </div>
          )}
        </article>
        <article className="panel span study-cta">
          <div className="min0">
            <h2><Bi t={b('المترجم والملخّص', 'Translate & summarise')} /></h2>
            <p className="note"><Bi t={b('ارفع الملزمة أو صوّرها: نترجمها، أو نطلّع منها خلاصة وأسئلة اختيار من متعدد، صح وخطأ، عدّد وعلّل.', 'Upload or photograph a handout: we translate it, or turn it into a summary with MCQ, true/false, list and give-reasons questions.')} /></p>
          </div>
          <button className="btn" type="button" onClick={() => go('study')}><Languages size={17} aria-hidden="true" /><Bi t={b('جرّبه', 'Try it')} /></button>
        </article>
        {settings.rep_name || settings.rep_contact ? (
          <article className="panel span rep">
            <h2><Bi t={b('ممثل المرحلة', 'Class representative')} /></h2>
            <dl className="kv">
              {settings.rep_name ? <><dt><Bi t={b('الاسم', 'Name')} /></dt><dd>{settings.rep_name}</dd></> : null}
              {settings.rep_contact ? <><dt><Bi t={b('للتواصل', 'Contact')} /></dt><dd dir="ltr" className="ltr-cell">{settings.rep_contact}</dd></> : null}
            </dl>
          </article>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Schedule ---------------- */
export function Schedule() {
  const { data, loaded, isStaff } = useStore();
  const subjects = useSubjects();
  const now = useNow();
  const withSat = data.schedule.some((l) => l.day === 6);
  const days = WEEK_ORDER.filter((d) => d !== 6 || withSat);
  const [day, setDay] = useState(days.includes(now.dow) ? now.dow : 0);
  const chipsRef = useRef(null);
  useEffect(() => {
    chipsRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [day, loaded]);
  const list = data.schedule.filter((l) => l.day === day).sort((x, y) => toMin(x.start_time) - toMin(y.start_time));
  return (
    <div className="stack-lg">
      <SecHead title={b('جدول الدوام', 'Timetable')} sub={b('المحاضرات النظرية والعملية لكل يوم', 'Theory and lab lectures for each day')}><AddButton type="schedule" label={b('أضف محاضرة', 'Add lecture')} /></SecHead>
      {!loaded ? <div className="panel"><Skeleton /></div> : !data.schedule.length ? (
        <Empty title={b('الجدول فارغ حالياً', 'The timetable is empty')}>{isStaff ? b('أضف محاضرات الأسبوع مع القاعة ونوع المحاضرة.', 'Add the week\'s lectures with the room and lecture type.') : b('يضيف الممثل جدول الأسبوع هنا.', 'The representative will add the weekly timetable here.')}</Empty>
      ) : (
        <>
          <div className="filters" role="group" aria-label="أيام الأسبوع / Days of the week" ref={chipsRef}>
            {days.map((d) => (
              <button key={d} type="button" className="fchip" aria-pressed={day === d} onClick={() => setDay(d)}>
                <Bi t={dayBi(d)} />{d === now.dow ? <span className="today-tag"><Bi t={b('اليوم', 'Today')} inline /></span> : null}
              </button>
            ))}
          </div>
          <div className="panel">
            {list.length ? <div className="lec-list">{list.map((l) => <LectureRow key={l.id} l={l} subj={subjects[l.subject_id]} isToday={day === now.dow} now={now} />)}</div>
              : <Empty title={b(`ماكو محاضرات يوم ${DAYS[day]}`, `No lectures on ${flat(dayBi(day)).split(' / ')[1]}`)} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Announcements ---------------- */
export function Announcements() {
  const { data, loaded, isStaff } = useStore();
  useEffect(() => { lsSet('ann-seen', new Date().toISOString()); }, [data.announcements]);
  const list = sortedAnnouncements(data.announcements);
  return (
    <div className="stack-lg">
      <SecHead title={b('الإعلانات', 'Announcements')} sub={b('تبليغات القسم والمرحلة', 'Department and class notices')}><AddButton type="announcement" label={b('إعلان جديد', 'New announcement')} /></SecHead>
      {!loaded ? <div className="panel"><Skeleton /></div> : !list.length ? (
        <Empty title={b('ماكو إعلانات بعد', 'No announcements yet')}>{isStaff ? b('انشر أي تأجيل أو تبليغ أو موعد تسليم هنا.', 'Post any postponement, notice or deadline here.') : b('أي تأجيل أو تبليغ ينشره الممثل يطلع هنا.', 'Any postponement or notice the representative posts appears here.')}</Empty>
      ) : (
        <div className="ann-list">
          {list.map((a) => (
            <article key={a.id} className={`ann${a.urgent ? ' urgent' : ''}`}>
              <div className="h">
                <div className="min0">
                  <h2>{a.title}</h2>
                  <div className="tags">
                    {a.urgent ? <span className="chip urgent"><Bi t={b('عاجل', 'Urgent')} inline /></span> : null}
                    {a.pinned ? <span className="chip"><Bi t={b('مثبّت', 'Pinned')} inline /></span> : null}
                    <span className="when"><Bi t={agoBi(a.created_at)} inline /></span>
                  </div>
                </div>
                <EditButton type="announcement" item={a} />
              </div>
              {a.body ? <p>{a.body}</p> : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function hasUnseenUrgent(announcements) {
  const seen = lsGet('ann-seen', null);
  return announcements.some((a) => a.urgent && (!seen || new Date(a.created_at) > new Date(seen)));
}

/* ---------------- Exams ---------------- */
function ExamCard({ e, subj }) {
  const n = daysUntil(e.exam_date);
  const cls = n < 0 ? '' : n <= 2 ? 'urgent' : n <= 7 ? 'warn' : '';
  return (
    <article className={`ecard${n < 0 ? ' past' : ''}`}>
      <div className="top"><span className={`chip ${cls}`}><Bi t={countdownBi(n)} inline /></span><EditButton type="exam" item={e} /></div>
      <div className="name"><Dot color={subj?.color} /><span>{subj?.name || <Bi t={DELETED} inline />}</span></div>
      <dl>
        <dt><Bi t={b('النوع', 'Type')} /></dt><dd><Bi t={kindBi('exam', e.kind)} /></dd>
        <dt><Bi t={b('التاريخ', 'Date')} /></dt><dd><Bi t={dateBi(e.exam_date)} /></dd>
        {e.exam_time ? <><dt><Bi t={b('الوقت', 'Time')} /></dt><dd className="num">{t12(e.exam_time)}</dd></> : null}
        {e.room ? <><dt><Bi t={b('المكان', 'Location')} /></dt><dd>{e.room}</dd></> : null}
      </dl>
      {e.syllabus ? <div className="syl"><b><Bi t={b('المادة المطلوبة', 'Syllabus')} inline />: </b>{e.syllabus}</div> : null}
    </article>
  );
}

export function Exams() {
  const { data, loaded, isStaff } = useStore();
  const subjects = useSubjects();
  const [showPast, setShowPast] = useState(false);
  const all = data.exams.slice().sort((x, y) => x.exam_date.localeCompare(y.exam_date));
  const up = all.filter((e) => daysUntil(e.exam_date) >= 0);
  const past = all.filter((e) => daysUntil(e.exam_date) < 0).reverse();
  return (
    <div className="stack-lg">
      <SecHead title={b('الامتحانات', 'Exams')} sub={b('مرتبة حسب الأقرب', 'Sorted by nearest first')}><AddButton type="exam" label={b('أضف امتحان', 'Add exam')} /></SecHead>
      {!loaded ? <div className="panel"><Skeleton /></div> : !all.length ? (
        <Empty title={b('ماكو امتحانات مضافة', 'No exams added')}>{isStaff ? b('أضف مواعيد الامتحانات حتى يشوفها الطلاب مع عدّاد الأيام.', 'Add the exam dates so students can see them with a day countdown.') : b('مواعيد الامتحانات تطلع هنا مع عدّاد الأيام.', 'Exam dates appear here with a day countdown.')}</Empty>
      ) : (
        <>
          {up.length ? <div className="cards">{up.map((e) => <ExamCard key={e.id} e={e} subj={subjects[e.subject_id]} />)}</div>
            : <Empty title={b('ماكو امتحانات قادمة', 'No upcoming exams')} />}
          {past.length ? (
            <div>
              <button type="button" className="collapse" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
                <Bi t={b(`امتحانات انتهت (${past.length})`, `Finished exams (${past.length})`)} /> <ChevronDown size={16} />
              </button>
              {showPast ? <div className="cards">{past.map((e) => <ExamCard key={e.id} e={e} subj={subjects[e.subject_id]} />)}</div> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ---------------- Materials ---------------- */
export function Materials() {
  const { data, loaded, isStaff } = useStore();
  const subjects = useSubjects();
  const [filter, setFilter] = useState('all');
  const list = data.materials.filter((m) => filter === 'all' || m.subject_id === filter);
  return (
    <div className="stack-lg">
      <SecHead title={b('المحاضرات والملفات', 'Lectures & files')} sub={b('روابط المحاضرات والملازم لكل مادة', 'Lecture and handout links for each subject')}><AddButton type="material" label={b('أضف ملف', 'Add file')} /></SecHead>
      {!loaded ? <div className="panel"><Skeleton /></div> : !data.materials.length ? (
        <Empty title={b('ماكو ملفات بعد', 'No files yet')}>{isStaff ? b('أضف روابط المحاضرات والملازم من Google Drive أو Telegram.', 'Add lecture and handout links from Google Drive or Telegram.') : b('روابط المحاضرات والملازم تطلع هنا مرتبة حسب المادة.', 'Lecture and handout links appear here, organised by subject.')}</Empty>
      ) : (
        <>
          <div className="filters" role="group" aria-label="تصفية حسب المادة / Filter by subject">
            <button type="button" className="fchip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><Bi t={b('كل المواد', 'All subjects')} /></button>
            {data.subjects.map((s) => (
              <button key={s.id} type="button" className="fchip" aria-pressed={filter === s.id} onClick={() => setFilter(s.id)}><Dot color={s.color} />{s.name}</button>
            ))}
          </div>
          <div className="stack">
            {list.length ? list.map((m) => {
              const u = safeUrl(m.url);
              return (
                <div key={m.id} className="mat">
                  <div className="min0">
                    <div className="t">{m.title}</div>
                    <div className="m">
                      <Dot color={subjects[m.subject_id]?.color} /><span>{subjects[m.subject_id]?.name || <Bi t={DELETED} inline />}</span>
                      <span className="chip"><Bi t={kindBi('mat', m.kind)} inline /></span>
                      {m.week ? <span className="num"><Bi t={b(`الأسبوع ${m.week}`, `Week ${m.week}`)} inline /></span> : null}
                    </div>
                  </div>
                  <div className="act">
                    <EditButton type="material" item={m} />
                    {u ? <a className="open-link" href={u} target="_blank" rel="noopener noreferrer"><Bi t={b('فتح', 'Open')} /> <ExternalLink size={14} /></a> : null}
                  </div>
                </div>
              );
            }) : <Empty title={b('ماكو ملفات لهذي المادة', 'No files for this subject')} />}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Absences ---------------- */
export function Absences() {
  const { data, setData, loaded, settings, notify } = useStore();
  const lim = Math.max(1, Number(settings.absence_limit) || 6);
  const timers = useRef({});
  const change = (sid, delta) => {
    const cur = Number(data.absences[sid]) || 0;
    const nextVal = Math.max(0, Math.min(99, cur + delta));
    if (nextVal === cur) return;
    setData((d) => ({ ...d, absences: { ...d.absences, [sid]: nextVal } }));
    clearTimeout(timers.current[sid]);
    timers.current[sid] = setTimeout(async () => {
      try {
        const uid = getSession()?.user_id;
        await db.upsert('absences', { user_id: uid, subject_id: sid, count: nextVal, updated_at: new Date().toISOString() }, 'user_id,subject_id');
      } catch (e) {
        notify(e.message || b('تعذّر حفظ الغياب', 'Couldn\'t save the absence'));
        setData((d) => ({ ...d, absences: { ...d.absences, [sid]: cur } }));
      }
    }, 600);
  };
  return (
    <div className="stack-lg">
      <SecHead title={b('غياباتي', 'My absences')} sub={b('عدّاد شخصي لغياباتك بكل مادة', 'A personal absence counter for each subject')} />
      {!loaded ? <div className="panel"><Skeleton /></div> : !data.subjects.length ? (
        <Empty title={b('ماكو مواد بعد', 'No subjects yet')}>{b('بعد ما يضيف الممثل المواد، تكدر تحسب غياباتك هنا.', 'Once the representative adds the subjects, you can track your absences here.')}</Empty>
      ) : (
        <>
          <div className="panel">
            {data.subjects.map((s) => {
              const n = Number(data.absences[s.id]) || 0;
              const pct = Math.min(100, (n / lim) * 100);
              const cls = n >= lim ? 'over' : n >= lim - 1 ? 'warn' : '';
              return (
                <div key={s.id} className="abs">
                  <div className="n">
                    <Dot color={s.color} />{s.name}
                    {n >= lim ? <span className="chip urgent"><Bi t={b('وصلت الحد', 'Limit reached')} inline /></span> : n >= lim - 1 ? <span className="chip warn"><Bi t={b('قريب من الحد', 'Near the limit')} inline /></span> : null}
                  </div>
                  <div className="stepper">
                    <button type="button" onClick={() => change(s.id, -1)} aria-label={`إنقاص غياب ${s.name} / Remove an absence: ${s.name}`}><Minus size={16} /></button>
                    <output className="num">{n} / {lim}</output>
                    <button type="button" onClick={() => change(s.id, 1)} aria-label={`إضافة غياب ${s.name} / Add an absence: ${s.name}`}><Plus size={16} /></button>
                  </div>
                  <div className={`bar ${cls}`}><i style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
          <p className="note"><Bi t={b(`غياباتك تظهر لك بس. حد الإنذار (${lim}) يحدده الممثل، وتأكد دائماً من تعليمات القسم الرسمية.`, `Only you can see your absences. The warning limit (${lim}) is set by the representative — always check the department's official rules.`)} /></p>
        </>
      )}
    </div>
  );
}

/* ---------------- Account ---------------- */
export function Account() {
  const { profile, setProfile, signOut, notify } = useStore();
  const [editing, setEditing] = useState(false);
  const [motion, setMotionState] = useState(getMotion());
  if (!profile) return <div className="panel"><Skeleton /></div>;
  const toggleMotion = (on) => { setMotionState(on); setMotion(on); };
  return (
    <div className="stack-lg">
      <SecHead title={b('حسابي', 'My account')} />
      <article className="panel idcard">
        <div className="id-top">
          <div>
            <div className="id-name">{profile.full_name || '—'}</div>
            <span className={`role${profile.role !== 'student' ? ' admin' : ''}`}><Bi t={ROLE_LABEL[profile.role]} inline /></span>
          </div>
        </div>
        <dl className="kv">
          <dt><Bi t={b('اسم المستخدم', 'Username')} /></dt><dd dir="ltr" className="ltr-cell mono">{profile.username}</dd>
          <dt><Bi t={b('الرقم الجامعي', 'Student ID')} /></dt><dd className="num">{profile.student_no || '—'}</dd>
          <dt><Bi t={b('الإيميل', 'Email')} /></dt><dd dir="ltr" className="ltr-cell">{profile.email}</dd>
        </dl>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => setEditing(true)}><Pencil size={15} /><Bi t={b('تعديل الاسم والرقم', 'Edit name & ID')} /></button>
          <button className="btn ghost" type="button" onClick={signOut}><LogOut size={15} /><Bi t={b('تسجيل الخروج', 'Sign out')} /></button>
        </div>
        <p className="note"><Bi t={b('نسيت رمزك؟ سجّل خروج واختار «نسيت الرمز» ويوصلك رمز جديد على إيميلك.', 'Forgot your PIN? Sign out and choose "Forgot your PIN" — a new one is emailed to you.')} /></p>
      </article>
      <article className="panel">
        <h2><Bi t={b('المظهر', 'Appearance')} /></h2>
        <label className="check switch">
          <input type="checkbox" checked={motion} onChange={(e) => toggleMotion(e.target.checked)} />
          <Bi t={b('الخلفية المتحركة', 'Animated background')} />
        </label>
        <p className="note"><Bi t={b('إذا جهازك يبطّئ أو تريد توفير البطارية، طفّي الحركة.', 'If your device feels slow or you want to save battery, turn the motion off.')} /></p>
      </article>
      <FormSheet
        open={editing}
        title={b('تعديل معلوماتي', 'Edit my details')}
        fields={[
          { k: 'full_name', label: b('الاسم الثلاثي', 'Full name'), type: 'text', required: true, maxLength: 80 },
          { k: 'student_no', label: b('الرقم الجامعي', 'Student ID'), type: 'text', maxLength: 30, ltr: true },
        ]}
        initial={profile}
        onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          const rows = await db.update('profiles', profile.id, { full_name: v.full_name, student_no: v.student_no });
          setProfile(rows[0]);
          setEditing(false);
          notify(b('تم الحفظ', 'Saved'));
        }}
      />
    </div>
  );
}
