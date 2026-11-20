'use server';

import { refresh } from 'next/cache';
import { addCourse, setCourseAccepting, validateCourse, type CourseErrors } from '@/lib/courses';
import { getDb } from '@/lib/db';
import { requireSuperAdmin } from '@/lib/session';

// Every action checks for a super admin itself: a Server Action is a public endpoint.

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
};

export async function setCourseOpenAction(form: FormData) {
  const admin = await requireSuperAdmin();
  const id = Number(text(form, 'id'));
  if (Number.isSafeInteger(id) && id > 0) await setCourseAccepting(await getDb(), admin.id, id, text(form, 'open') === '1');
  refresh();
}

export type CourseState = { errors?: CourseErrors; error?: string; saved?: boolean } | undefined;

export async function addCourseAction(_prev: CourseState, form: FormData): Promise<CourseState> {
  const admin = await requireSuperAdmin();
  const checked = validateCourse({ name: text(form, 'name'), teacher: text(form, 'teacher'), place: text(form, 'place'), startedOn: text(form, 'startedOn'), open: text(form, 'open') === 'on' });
  if (!checked.ok) return { errors: checked.errors, error: 'راجع الحقول المعلّمة.' };
  await addCourse(await getDb(), admin.id, checked.value);
  refresh();
  return { saved: true };
}
