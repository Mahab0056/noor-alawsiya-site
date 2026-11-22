'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/lib/db';
import { progressEnabled } from '@/lib/flags';
import { arDigits } from '@/lib/format';
import { deleteSession, MAX_NOTE, saveAttendance, setCourseRecorder, type EntryInput, type SaveFailure } from '@/lib/progress';
import { requireRecorder, requireSuperAdmin } from '@/lib/session';

// Every action checks the session and the flag itself (a Server Action is a public endpoint), and lib/progress.ts
// checks the admin against the course in the database again.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};
const posInt = (v: string) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

export type AttendanceState = { ok?: string; error?: string; noteFor?: number } | undefined;

const WHY: Record<SaveFailure, string> = {
  forbidden: 'لا تستطيع تسجيل الحضور لهذه الدورة. إن كانت حلقتك فاطلب من المدير الأعلى أن يضيفك إليها.',
  'bad-date': 'التاريخ غير صحيح. اختر يوماً من هذه السنة.',
  future: 'لا يُسجَّل حضور ليوم لم يأتِ بعد.',
  locked: 'انتهى وقت التعديل لهذا اليوم: يُعدَّل الحضور حتى الجمعة من الأسبوع نفسه. للتصحيح راسل إدارة المدرسة.',
  empty: 'لا يوجد طلاب مقبولون في هذه الدورة بعد.',
  'bad-input': 'تعذّر قراءة النموذج. حدّث الصفحة وأعد الحفظ.',
  'note-long': `إحدى الملاحظات أطول من ${arDigits(MAX_NOTE)} حرف. اختصرها وأعد الحفظ.`,
  'not-enrolled': 'تغيّرت قائمة الطلاب منذ فتحت الصفحة. حدّث الصفحة وأعد الحفظ.',
};

/** The form sends `student` once per pupil, with `status-<id>` and `note-<id>`. */
export async function saveAttendanceAction(_prev: AttendanceState, form: FormData): Promise<AttendanceState> {
  const admin = await requireRecorder();
  if (!progressEnabled()) return { error: 'متابعة الحضور غير مفعّلة الآن.' };
  const courseId = posInt(text(form, 'course'));
  if (!courseId) return { error: WHY['bad-input'] };
  const entries: EntryInput[] = form.getAll('student').slice(0, 201).map((v) => {
    const id = typeof v === 'string' ? v : '';
    return { studentId: id, status: text(form, `status-${id}`), note: text(form, `note-${id}`) };
  });
  const result = await saveAttendance(await getDb(), admin.id, courseId, text(form, 'date'), entries);
  if (!result.ok) return { error: WHY[result.reason], noteFor: result.studentId };
  refresh();
  return {
    ok: `حُفظ الحضور: ${arDigits(result.present)} حاضر، ${arDigits(result.absent)} غائب، ${arDigits(result.excused)} مجاز. يظهر الآن في حساب كل طالب.`,
  };
}

/** Super admin: who may record for this course. */
export async function setRecorderAction(form: FormData) {
  const admin = await requireSuperAdmin();
  const courseId = posInt(text(form, 'course'));
  const adminId = posInt(text(form, 'admin'));
  if (progressEnabled() && courseId && adminId) await setCourseRecorder(await getDb(), admin.id, courseId, adminId, text(form, 'on') === '1');
  refresh();
}

/** Super admin: removes a session recorded on the wrong day. */
export async function deleteSessionAction(form: FormData) {
  const admin = await requireSuperAdmin();
  const courseId = posInt(text(form, 'course'));
  if (!progressEnabled() || !courseId) redirect('/admin/progress');
  await deleteSession(await getDb(), admin.id, courseId, text(form, 'date'));
  redirect(`/admin/progress/${courseId}?deleted=1`);
}
