import React, { createContext, useCallback, useContext, useState } from 'react';
import { db } from './client';
import { useStore } from './store';
import { FormSheet } from './ui';
import { b } from './bi';
import { WEEK_ORDER, EXAM_KINDS, MAT_KINDS, SWATCHES, dayBi, kindBi, toMin, hhmm } from './util';

const EditorCtx = createContext(() => {});
export const useEditor = () => useContext(EditorCtx);

const TABLE = { subject: 'subjects', schedule: 'schedule', announcement: 'announcements', exam: 'exams', material: 'materials' };
const TITLES = {
  subject: [b('مادة جديدة', 'New subject'), b('تعديل المادة', 'Edit subject')],
  schedule: [b('محاضرة جديدة', 'New lecture'), b('تعديل المحاضرة', 'Edit lecture')],
  announcement: [b('إعلان جديد', 'New announcement'), b('تعديل الإعلان', 'Edit announcement')],
  exam: [b('امتحان جديد', 'New exam'), b('تعديل الامتحان', 'Edit exam')],
  material: [b('ملف جديد', 'New file'), b('تعديل الملف', 'Edit file')],
};

function fieldsFor(type, subjects) {
  const subjOpts = subjects.map((s) => [s.id, s.name]);
  const SUBJECT = b('المادة', 'Subject');
  const ROOM_PH = 'مثال: قاعة 3 / مختبر الوراثة';
  switch (type) {
    case 'subject': return [
      { k: 'name', label: b('اسم المادة', 'Subject name'), type: 'text', required: true, maxLength: 80, placeholder: 'مثال: الأحياء الجزيئية' },
      { k: 'code', label: b('رمز المادة', 'Subject code'), type: 'text', half: true, maxLength: 20, ltr: true, placeholder: 'BIO 401' },
      { k: 'teacher', label: b('أستاذ المادة', 'Instructor'), type: 'text', half: true, maxLength: 80 },
      { k: 'color', label: b('لون المادة', 'Subject colour'), type: 'swatch' },
    ];
    case 'schedule': return [
      { k: 'subject_id', label: SUBJECT, type: 'select', required: true, options: subjOpts },
      { k: 'day', label: b('اليوم', 'Day'), type: 'select', required: true, half: true, options: WEEK_ORDER.map((d) => [String(d), dayBi(d)]) },
      { k: 'type', label: b('النوع', 'Type'), type: 'select', required: true, half: true, options: [['نظري', kindBi('type', 'نظري')], ['عملي', kindBi('type', 'عملي')]] },
      { k: 'start_time', label: b('من', 'From'), type: 'time', required: true, half: true },
      { k: 'end_time', label: b('إلى', 'To'), type: 'time', required: true, half: true },
      { k: 'room', label: b('القاعة أو المختبر', 'Room or lab'), type: 'text', maxLength: 80, placeholder: ROOM_PH },
      { k: 'note', label: b('ملاحظة', 'Note'), type: 'text', maxLength: 160 },
    ];
    case 'announcement': return [
      { k: 'title', label: b('العنوان', 'Title'), type: 'text', required: true, maxLength: 120 },
      { k: 'body', label: b('التفاصيل', 'Details'), type: 'textarea', maxLength: 4000 },
      { k: 'urgent', label: b('إعلان عاجل', 'Urgent'), type: 'check', half: true },
      { k: 'pinned', label: b('تثبيت بالأعلى', 'Pin to top'), type: 'check', half: true },
    ];
    case 'exam': return [
      { k: 'subject_id', label: SUBJECT, type: 'select', required: true, options: subjOpts },
      { k: 'kind', label: b('نوع الامتحان', 'Exam type'), type: 'select', required: true, half: true, options: EXAM_KINDS.map((k) => [k, kindBi('exam', k)]) },
      { k: 'exam_date', label: b('التاريخ', 'Date'), type: 'date', required: true, half: true },
      { k: 'exam_time', label: b('الوقت', 'Time'), type: 'time', half: true },
      { k: 'room', label: b('المكان', 'Location'), type: 'text', half: true, maxLength: 80 },
      { k: 'syllabus', label: b('المادة المطلوبة', 'Syllabus'), type: 'textarea', maxLength: 1000, placeholder: 'مثال: المحاضرات 1–4' },
    ];
    case 'material': return [
      { k: 'subject_id', label: SUBJECT, type: 'select', required: true, options: subjOpts },
      { k: 'title', label: b('العنوان', 'Title'), type: 'text', required: true, maxLength: 160, placeholder: 'مثال: المحاضرة الثالثة' },
      { k: 'url', label: b('الرابط', 'Link'), type: 'url', required: true, maxLength: 2000, placeholder: 'https://drive.google.com/…', hint: b('رابط Google Drive أو Telegram أو أي رابط يبدي بـ https', 'A Google Drive, Telegram or any https link') },
      { k: 'kind', label: b('النوع', 'Type'), type: 'select', required: true, half: true, options: MAT_KINDS.map((k) => [k, kindBi('mat', k)]) },
      { k: 'week', label: b('الأسبوع', 'Week'), type: 'number', half: true, min: 1, max: 30 },
    ];
    default: return [];
  }
}

function defaults(type, subjects) {
  const today = new Date().getDay();
  switch (type) {
    case 'subject': return { color: SWATCHES[subjects.length % SWATCHES.length] };
    case 'schedule': return { day: String(WEEK_ORDER.includes(today) ? today : 0), type: 'نظري', start_time: '08:30', end_time: '10:00' };
    case 'exam': return { kind: 'شهري' };
    case 'material': return { kind: 'محاضرة' };
    default: return {};
  }
}

function toForm(type, item) {
  if (!item) return item;
  const v = { ...item };
  if (type === 'schedule') { v.start_time = hhmm(item.start_time); v.end_time = hhmm(item.end_time); v.day = String(item.day); }
  if (type === 'exam') v.exam_time = hhmm(item.exam_time);
  return v;
}

function toRow(type, v) {
  switch (type) {
    case 'subject': return { name: v.name, code: v.code, teacher: v.teacher, color: v.color };
    case 'schedule': {
      if (toMin(v.end_time) <= toMin(v.start_time)) throw new Error(b('وقت النهاية لازم يكون بعد وقت البداية.', 'The end time must be after the start time.'));
      return { subject_id: v.subject_id, day: Number(v.day), type: v.type, start_time: v.start_time, end_time: v.end_time, room: v.room, note: v.note };
    }
    case 'announcement': return { title: v.title, body: v.body, urgent: !!v.urgent, pinned: !!v.pinned };
    case 'exam': return { subject_id: v.subject_id, kind: v.kind, exam_date: v.exam_date, exam_time: v.exam_time || null, room: v.room, syllabus: v.syllabus };
    case 'material': return { subject_id: v.subject_id, title: v.title, url: v.url, kind: v.kind, week: v.week };
    default: return v;
  }
}

export function EditorProvider({ children }) {
  const { data, reload, notify, isStaff } = useStore();
  const [state, setState] = useState(null); // {type, item}

  const open = useCallback((type, item = null) => {
    if (!isStaff) return;
    if (type !== 'subject' && type !== 'announcement' && !data.subjects.length) {
      notify(b('أضف المواد أولاً', 'Add subjects first'));
      setState({ type: 'subject', item: null });
      return;
    }
    setState({ type, item });
  }, [isStaff, data.subjects.length, notify]);

  const close = useCallback(() => setState(null), []);

  let sheet = null;
  if (state) {
    const { type, item } = state;
    const table = TABLE[type];
    const onSubmit = async (v) => {
      const row = toRow(type, v);
      if (type === 'announcement' && item) row.updated_at = new Date().toISOString();
      if (item) await db.update(table, item.id, row); else await db.insert(table, row);
      setState(null);
      notify(item ? b('تم الحفظ', 'Saved') : b('تمت الإضافة', 'Added'));
      reload();
    };
    const onDelete = item ? async () => {
      await db.remove(table, item.id);
      setState(null);
      notify(b('تم الحذف', 'Deleted'));
      reload();
    } : undefined;
    sheet = (
      <FormSheet
        open
        title={TITLES[type][item ? 1 : 0]}
        fields={fieldsFor(type, data.subjects)}
        initial={item ? toForm(type, item) : defaults(type, data.subjects)}
        onSubmit={onSubmit}
        onDelete={onDelete}
        deleteWarning={type === 'subject' ? b('حذف المادة يحذف معها محاضراتها وامتحاناتها وملفاتها وغيابات الطلاب بيها.', 'Deleting a subject also deletes its lectures, exams, files and students\' absence counts.') : ''}
        onClose={close}
      />
    );
  }

  return (
    <EditorCtx.Provider value={open}>
      {children}
      {sheet}
    </EditorCtx.Provider>
  );
}
