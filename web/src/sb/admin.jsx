import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Check, Pencil, Plus, Search, RefreshCw } from 'lucide-react';
import { useStore } from './store';
import { useEditor } from './editor';
import { db, request } from './client';
import { Dot, Empty, Skeleton, FormSheet } from './ui';
import { b, Bi, T, flat } from './bi';
import { ROLE_LABEL, dateBi } from './util';

function copyText(text, done) {
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(true);
    } catch { done(false); }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), fallback);
  else fallback();
}

function JoinCode() {
  const { notify } = useStore();
  const [code, setCode] = useState(null);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    try { setCode(await db.rpc('get_join_code')); setErr(''); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <article className="panel">
      <h2><Bi t={b('رمز القسم', 'Department code')} /></h2>
      <p className="note"><Bi t={b('أي طالب يسجل لازم يكتب هذا الرمز. شاركه بكروب المرحلة بس، وغيّره إذا انتشر برّه.', 'Every student must enter this code to register. Share it only in your class group, and change it if it leaks.')} /></p>
      {err ? <div className="form-err"><Bi t={err} /></div> : code == null ? <Skeleton /> : (
        <div className="joincode">
          <span dir="ltr" className="mono big">{code}</span>
          <button className="btn ghost sm" type="button" onClick={() => copyText(code, (ok) => { setCopied(ok); if (ok) setTimeout(() => setCopied(false), 1800); else notify(b('انسخ الرمز يدوياً', 'Copy the code manually')); })}>
            {copied ? <Check size={15} /> : <Copy size={15} />}<Bi t={copied ? b('تم النسخ', 'Copied') : b('نسخ', 'Copy')} />
          </button>
          <button className="btn ghost sm" type="button" onClick={() => setEditing(true)}><Bi t={b('تغيير الرمز', 'Change code')} /></button>
        </div>
      )}
      <FormSheet
        open={editing}
        title={b('تغيير رمز القسم', 'Change department code')}
        fields={[{ k: 'code', label: b('الرمز الجديد', 'New code'), type: 'text', required: true, maxLength: 20, ltr: true, hint: b('من 4 إلى 20 حرف: A-Z و 0-9 و -', '4–20 characters: A–Z, 0–9 and -') }]}
        initial={{ code: code || '' }}
        onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          await db.rpc('set_join_code', { p_code: v.code });
          setEditing(false);
          notify(b('تم تغيير الرمز', 'Code changed'));
          load();
        }}
      />
    </article>
  );
}

function SettingsPanel() {
  const { settings, setSettings, notify } = useStore();
  const [editing, setEditing] = useState(false);
  const rows = [
    [b('الجامعة', 'University'), settings.university], [b('القسم', 'Department'), settings.department], [b('المرحلة', 'Stage'), settings.stage],
    [b('الشعبة', 'Section'), settings.section], [b('اسم الممثل', 'Representative'), settings.rep_name], [b('للتواصل', 'Contact'), settings.rep_contact],
    [b('حد الإنذار للغياب', 'Absence warning limit'), settings.absence_limit],
  ];
  return (
    <article className="panel">
      <h2><Bi t={b('معلومات المرحلة', 'Class information')} /> <button className="link" type="button" onClick={() => setEditing(true)}><Bi t={b('تعديل', 'Edit')} inline /></button></h2>
      <dl className="kv">{rows.map(([k, v]) => <React.Fragment key={k}><dt><Bi t={k} /></dt><dd>{v === '' || v == null ? '—' : String(v)}</dd></React.Fragment>)}</dl>
      <FormSheet
        open={editing}
        title={b('معلومات المرحلة', 'Class information')}
        fields={[
          { k: 'university', label: b('الجامعة', 'University'), type: 'text', half: true, maxLength: 80 },
          { k: 'department', label: b('القسم', 'Department'), type: 'text', half: true, maxLength: 80 },
          { k: 'stage', label: b('المرحلة', 'Stage'), type: 'text', half: true, maxLength: 60, placeholder: 'مثال: المرحلة الرابعة' },
          { k: 'section', label: b('الشعبة', 'Section'), type: 'text', half: true, maxLength: 60, placeholder: 'مثال: شعبة أ / صباحي' },
          { k: 'rep_name', label: b('اسم الممثل', 'Representative name'), type: 'text', half: true, maxLength: 80 },
          { k: 'rep_contact', label: b('رقم أو معرف التواصل', 'Phone or handle'), type: 'text', half: true, maxLength: 80, ltr: true },
          { k: 'absence_limit', label: b('حد الإنذار للغياب (لكل مادة)', 'Absence warning limit (per subject)'), type: 'number', half: true, min: 1, max: 99 },
        ]}
        initial={settings}
        onClose={() => setEditing(false)}
        onSubmit={async (v) => {
          const patch = { ...v, absence_limit: v.absence_limit || 6, updated_at: new Date().toISOString() };
          const updated = await request('/rest/v1/settings?id=eq.1', {
            method: 'PATCH', body: patch, headers: { Prefer: 'return=representation' },
          });
          if (!updated || !updated.length) throw new Error(b('ما عندك صلاحية لهذا الإجراء.', 'You don\'t have permission to do this.'));
          setSettings((s) => ({ ...s, ...updated[0] }));
          setEditing(false);
          notify(b('تم الحفظ', 'Saved'));
        }}
      />
    </article>
  );
}

function SubjectsPanel() {
  const { data } = useStore();
  const edit = useEditor();
  return (
    <article className="panel">
      <h2><Bi t={b('المواد الدراسية', 'Subjects')} /> <button className="link" type="button" onClick={() => edit('subject')}><Plus size={14} /><Bi t={b('مادة', 'Subject')} inline /></button></h2>
      {!data.subjects.length ? <Empty title={b('ماكو مواد', 'No subjects')}>{b('أضف المواد أولاً حتى تربطها بالجدول والامتحانات.', 'Add subjects first so you can link them to the schedule and exams.')}</Empty> : data.subjects.map((s) => (
        <div key={s.id} className="subj-row">
          <div className="l"><Dot color={s.color} /><div className="min0"><b>{s.name}</b> {s.code ? <span className="code">{s.code}</span> : null}<div className="note">{s.teacher}</div></div></div>
          <button className="icon-btn" type="button" onClick={() => edit('subject', s)} aria-label={`تعديل / Edit ${s.name}`}><Pencil size={16} /></button>
        </div>
      ))}
    </article>
  );
}

function MemberActions({ m, onDone }) {
  const { profile, isOwner, notify } = useStore();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  if (m.id === profile.id || m.role === 'owner') return null;
  if (m.role === 'rep' && !isOwner) return null;
  const run = async (fn, args, ok) => {
    setBusy(true);
    try { await db.rpc(fn, args); notify(ok); onDone(); } catch (e) { notify(e.message); } finally { setBusy(false); setArmed(false); }
  };
  return (
    <div className="m-actions">
      {isOwner ? (m.role === 'student'
        ? <button className="btn ghost sm" type="button" disabled={busy} onClick={() => run('set_member_role', { p_user: m.id, p_role: 'rep' }, b('صار ممثل', 'Promoted to representative'))}><Bi t={b('رفع لممثل', 'Make rep')} /></button>
        : <button className="btn ghost sm" type="button" disabled={busy} onClick={() => run('set_member_role', { p_user: m.id, p_role: 'student' }, b('رجع طالب', 'Changed back to student'))}>{<Bi t={b('إرجاع لطالب', 'Make student')} />}</button>) : null}
      {m.status === 'active'
        ? <button className="btn ghost sm" type="button" disabled={busy} onClick={() => run('set_member_status', { p_user: m.id, p_status: 'disabled' }, b('تم إيقاف الحساب', 'Account suspended'))}>{<Bi t={b('إيقاف', 'Suspend')} />}</button>
        : <button className="btn ghost sm" type="button" disabled={busy} onClick={() => run('set_member_status', { p_user: m.id, p_status: 'active' }, b('تم تفعيل الحساب', 'Account activated'))}>{<Bi t={b('تفعيل', 'Activate')} />}</button>}
      <button className={`btn danger sm${armed ? ' armed' : ''}`} type="button" disabled={busy}
        onClick={() => (armed ? run('delete_member', { p_user: m.id }, b('تم حذف الحساب', 'Account deleted')) : setArmed(true))}>
        <Bi t={armed ? b('تأكيد الحذف', 'Confirm delete') : b('حذف', 'Delete')} />
      </button>
    </div>
  );
}

function MembersPanel() {
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const load = useCallback(async () => {
    try {
      setMembers(await db.select('profiles', 'select=id,username,email,full_name,student_no,role,status,created_at&order=created_at.asc'));
      setErr('');
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const shown = useMemo(() => {
    if (!members) return [];
    const s = q.trim().toLowerCase();
    if (!s) return members;
    return members.filter((m) => [m.full_name, m.username, m.student_no, m.email].some((x) => (x || '').toLowerCase().includes(s)));
  }, [members, q]);
  return (
    <article className="panel span">
      <h2><Bi t={b('الطلاب المسجلين', 'Registered students')} /> {members ? <span className="count-pill num">{members.length}</span> : null}
        <button className="link" type="button" onClick={load}><RefreshCw size={14} /><Bi t={b('تحديث', 'Refresh')} inline /></button>
      </h2>
      <div className="search">
        <Search size={16} aria-hidden="true" />
        <input type="search" placeholder="ابحث بالاسم أو اليوزر أو الرقم الجامعي · Search name, username or ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث عن طالب / Search students" />
      </div>
      {err ? <div className="form-err"><Bi t={err} /></div> : members == null ? <Skeleton /> : !shown.length ? <Empty title={b('ماكو نتائج', 'No results')} /> : (
        <div className="members">
          {shown.map((m) => (
            <div key={m.id} className={`member${m.status === 'disabled' ? ' off' : ''}`}>
              <div className="min0">
                <div className="mname">{m.full_name || '—'} <span className={`role${m.role !== 'student' ? ' admin' : ''}`}><Bi t={ROLE_LABEL[m.role]} inline /></span>{m.status === 'disabled' ? <span className="chip urgent"><Bi t={b('موقوف', 'Suspended')} inline /></span> : null}</div>
                <div className="note">
                  <span dir="ltr" className="mono">{m.username}</span>
                  {m.student_no ? <> · <span className="num">{m.student_no}</span></> : null}
                  {' · '}<span dir="ltr">{m.email}</span>
                  {' · '}<Bi t={b('سجّل', 'Joined')} inline /> <Bi t={dateBi(String(m.created_at).slice(0, 10))} inline />
                </div>
              </div>
              <MemberActions m={m} onDone={load} />
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export default function AdminPanel() {
  const { isStaff, loaded } = useStore();
  if (!isStaff) return <Empty title={b('هذي الصفحة للممثل بس', 'This page is for the representative only')} />;
  return (
    <div className="stack-lg">
      <div className="sec-head"><div><h1><Bi t={b('لوحة الممثل', 'Representative panel')} /></h1><p><Bi t={b('كل تعديل هنا يوصل لجميع الطلاب مباشرة', 'Every change here reaches all students immediately')} /></p></div></div>
      {!loaded ? <div className="panel"><Skeleton /></div> : (
        <div className="home-grid">
          <SettingsPanel />
          <JoinCode />
          <SubjectsPanel />
          <article className="panel">
            <h2><Bi t={b('طريقة إضافة الطلاب', 'How to add students')} /></h2>
            <ol className="guide">
              <li><Bi ar={<>دز رابط التطبيق و<b>رمز القسم</b> بكروب المرحلة.</>} en={<>Send the app link and the <b>department code</b> to your class group.</>} /></li>
              <li><Bi ar="كل طالب يضغط «سجّل»، ويكتب اسمه وإيميله ورمز القسم." en="Each student taps Register and enters their name, email and the department code." /></li>
              <li><Bi ar={<>يوصله على إيميله <b>يوزر ورمز PIN عشوائي</b> خاص بيه، وما يتكرر لأي طالب ثاني.</>} en={<>A private, random <b>username and PIN</b> is emailed to them and never repeats for anyone else.</>} /></li>
              <li><Bi ar="الطالب يشوف كلشي بدون ما يكدر يعدّل. التعديل لك وللممثلين بس." en="Students can view everything but can't edit. Only you and the representatives can." /></li>
            </ol>
          </article>
          <MembersPanel />
        </div>
      )}
    </div>
  );
}
