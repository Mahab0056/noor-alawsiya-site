'use server';

import { refresh, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { addCourse, setCourseAccepting, setCourseSeats, validateCourse, type CourseErrors } from '@/lib/courses';
import { getDb } from '@/lib/db';
import { PUBLIC_COURSES_TAG } from '@/lib/public-courses-cache';
import { courseSeatsOn, parseSeats } from '@/lib/seats';
import { requireSuperAdmin } from '@/lib/session';

// Every action checks for a super admin itself: a Server Action is a public endpoint.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export async function setCourseOpenAction(form: FormData) {
  const admin = await requireSuperAdmin();
  const id = Number(text(form, 'id'));
  if (Number.isSafeInteger(id) && id > 0) {
    const result = await setCourseAccepting(await getDb(), admin.id, id, text(form, 'open') === '1');
    if (result === 'full') redirect(`/admin/courses?full=${id}`); // nothing changed: the page says why
  }
  updateTag(PUBLIC_COURSES_TAG); // home and /courses show the change at once
  refresh();
}

/** «عدد المقاعد» for one course (COURSE_SEATS only). Empty = no limit. */
export async function setCourseSeatsAction(form: FormData) {
  const admin = await requireSuperAdmin();
  if (!courseSeatsOn()) return;
  const id = Number(text(form, 'id'));
  if (!Number.isSafeInteger(id) || id <= 0) return;
  const seats = parseSeats(text(form, 'seats'));
  if (!seats.ok) redirect(`/admin/courses?seatsError=${id}`);
  const result = await setCourseSeats(await getDb(), admin.id, id, seats.value);
  updateTag(PUBLIC_COURSES_TAG);
  redirect(`/admin/courses?${result === 'closed' ? 'closed' : 'seatsSaved'}=${id}`);
}

export type CourseState = { errors?: CourseErrors; error?: string; saved?: boolean } | undefined;

export async function addCourseAction(_prev: CourseState, form: FormData): Promise<CourseState> {
  const admin = await requireSuperAdmin();
  const checked = validateCourse({
    name: text(form, 'name'), teacher: text(form, 'teacher'), place: text(form, 'place'), startedOn: text(form, 'startedOn'), open: text(form, 'open') === 'on',
    ...(courseSeatsOn() ? { seats: text(form, 'seats') } : {}),
  });
  if (!checked.ok) return { errors: checked.errors, error: 'راجع الحقول المعلّمة.' };
  await addCourse(await getDb(), admin.id, checked.value);
  updateTag(PUBLIC_COURSES_TAG);
  refresh();
  return { saved: true };
}
