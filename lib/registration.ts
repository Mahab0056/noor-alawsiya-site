import 'server-only';
import { hashPassword, normalizePhone } from './auth';
import { isMinor, isVisible, MAX_TEXT, MIN_PASSWORD, NO, toYear, YES, type Answers, type FieldErrors, type FormQuestion, type OpenCourse, type QuestionKind, type ShowIf } from './form-rules';
import type { Db } from './db';

/**
 * Registration: the questionnaire the admin defines, validation of a submission,
 * and creating the student, the registration and its answers in one transaction.
 */

export { ADULT_AGE, MAX_TEXT, YES, NO, isMinor, isVisible } from './form-rules';
export type { Answers, FieldErrors, FormQuestion, OpenCourse, QuestionKind, ShowIf } from './form-rules';

export type RegistrationInput = {
  fullName: string;
  birthYear: string;
  phone: string;
  password: string;
  guardianName: string;
  guardianPhone: string;
  guardianConsent: boolean;
  courseId: string;
  answers: Answers;
};

type QuestionRow = { id: string; label: string; kind: QuestionKind; options: string[]; required: boolean; position: number; show_if: ShowIf; active: boolean };
const toQuestion = (r: QuestionRow): FormQuestion => ({ id: Number(r.id), label: r.label, kind: r.kind, options: r.options ?? [], required: r.required, position: r.position, showIf: r.show_if, active: r.active });

export async function listQuestions(db: Db, { includeInactive = false } = {}) {
  const rows = await db.query<QuestionRow>(`select id, label, kind, options, required, position, show_if, active from form_questions ${includeInactive ? '' : 'where active'} order by position, id`);
  return rows.map(toQuestion);
}

export async function listOpenCourses(db: Db) {
  const rows = await db.query<{ id: string; name: string; kind: string | null; teacher: string; place: string | null }>(
    `select id, name, kind, teacher, place from courses where published and status = 'open' order by id`
  );
  return rows.map((r): OpenCourse => ({ ...r, id: Number(r.id) }));
}

/** Checks the answers against the questionnaire and returns only the answers that should be stored. */
export function validateAnswers(questions: FormQuestion[], answers: Answers) {
  const errors: FieldErrors = {};
  const clean: Record<number, string | string[]> = {};
  for (const q of questions) {
    if (!isVisible(q, answers)) continue; // hidden questions are ignored even if a value was posted
    const key = `q${q.id}`;
    const raw = answers[String(q.id)];
    const empty = raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if (q.required) errors[key] = 'هذا السؤال مطلوب.';
      continue;
    }
    if (q.kind === 'multi') {
      const list = Array.isArray(raw) ? raw : [raw];
      if (!list.every((v) => q.options.includes(v))) errors[key] = 'اختر من الخيارات المعروضة.';
      else clean[q.id] = [...new Set(list)];
    } else if (Array.isArray(raw)) {
      errors[key] = 'إجابة غير صالحة.';
    } else if (q.kind === 'single') {
      if (!q.options.includes(raw)) errors[key] = 'اختر من الخيارات المعروضة.';
      else clean[q.id] = raw;
    } else if (q.kind === 'yes_no') {
      if (raw !== YES && raw !== NO) errors[key] = 'اختر نعم أو لا.';
      else clean[q.id] = raw;
    } else {
      const text = raw.trim();
      if (text.length > MAX_TEXT) errors[key] = `الإجابة أطول من ${MAX_TEXT} حرف.`;
      else if (text) clean[q.id] = text;
      else if (q.required) errors[key] = 'هذا السؤال مطلوب.';
    }
  }
  return { errors, clean };
}

export type CleanStudent = { fullName: string; birthYear: number; phone: string; guardianName: string | null; guardianPhone: string | null; minor: boolean };

/** Validates the student's own details. */
export function validateStudent(input: RegistrationInput, now = new Date()) {
  const errors: FieldErrors = {};
  const fullName = input.fullName.trim().replace(/\s+/g, ' ');
  if (fullName.length < 5 || fullName.split(' ').length < 2) errors.fullName = 'اكتب الاسم الثنائي على الأقل.';
  else if (fullName.length > 80) errors.fullName = 'الاسم طويل جداً.';

  const birthYear = toYear(input.birthYear);
  const year = now.getFullYear();
  if (!Number.isInteger(birthYear) || birthYear < year - 90 || birthYear > year - 5) errors.birthYear = 'اكتب سنة الميلاد بأربعة أرقام.';

  const phone = normalizePhone(input.phone);
  if (!phone) errors.phone = 'اكتب رقم هاتف عراقياً صحيحاً، مثل 07701234567.';

  if (input.password.length < MIN_PASSWORD) errors.password = `كلمة المرور ${MIN_PASSWORD} أحرف على الأقل.`;
  else if (input.password.length > 200) errors.password = 'كلمة المرور طويلة جداً.';

  const minor = !errors.birthYear && isMinor(birthYear, now);
  let guardianName: string | null = null;
  let guardianPhone: string | null = null;
  if (minor) {
    guardianName = input.guardianName.trim().replace(/\s+/g, ' ');
    if (guardianName.length < 5) errors.guardianName = 'اكتب اسم ولي الأمر.';
    guardianPhone = normalizePhone(input.guardianPhone);
    if (!guardianPhone) errors.guardianPhone = 'اكتب رقم هاتف ولي الأمر.';
    if (!input.guardianConsent) errors.guardianConsent = 'التسجيل لمن هو دون ١٨ سنة يحتاج موافقة ولي الأمر.';
  }
  return { errors, clean: { fullName, birthYear, phone: phone ?? '', guardianName, guardianPhone, minor } satisfies CleanStudent };
}

export const CONSENT_VERSION = '2026-11-18';

export type RegisterResult = { ok: true; studentId: number; registrationId: number } | { ok: false; errors: FieldErrors };

/** Validates everything and, if valid, stores the student, the registration and the answers together. */
export async function register(db: Db, input: RegistrationInput): Promise<RegisterResult> {
  const student = validateStudent(input);
  const questions = await listQuestions(db);
  const answers = validateAnswers(questions, input.answers);
  const errors: FieldErrors = { ...student.errors, ...answers.errors };

  const courses = await listOpenCourses(db);
  const course = courses.find((c) => String(c.id) === input.courseId);
  if (!course) errors.courseId = 'اختر دورة من الدورات المفتوحة.';
  if (Object.keys(errors).length) return { ok: false, errors };

  const s = student.clean;
  const [exists] = await db.query('select 1 from students where phone = $1 and full_name = $2', [s.phone, s.fullName]);
  if (exists) return { ok: false, errors: { phone: 'يوجد حساب بهذا الاسم ورقم الهاتف. سجّل الدخول لمتابعة طلبك.' } };

  const passwordHash = await hashPassword(input.password);
  return db.tx(async (t) => {
    const [st] = await t.query<{ id: string }>(
      `insert into students (full_name, birth_year, phone, password_hash, guardian_name, guardian_phone, guardian_consent_at, consent_version)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [s.fullName, s.birthYear, s.phone, passwordHash, s.guardianName, s.guardianPhone, s.minor ? new Date() : null, s.minor ? CONSENT_VERSION : null]
    );
    const [reg] = await t.query<{ id: string }>('insert into registrations (student_id, course_id) values ($1, $2) returning id', [st.id, course!.id]);
    for (const [questionId, answer] of Object.entries(answers.clean)) {
      await t.query('insert into registration_answers (registration_id, question_id, answer) values ($1, $2, $3)', [reg.id, questionId, JSON.stringify(answer)]);
    }
    return { ok: true as const, studentId: Number(st.id), registrationId: Number(reg.id) };
  });
}

export type RegistrationStatus = 'pending' | 'accepted' | 'rejected';
export type StudentRegistration = { id: number; course: string; teacher: string; status: RegistrationStatus; adminNote: string | null; createdAt: Date; reviewedAt: Date | null };

/** What a student sees about their own requests. */
export async function listStudentRegistrations(db: Db, studentId: number) {
  const rows = await db.query<{ id: string; course: string; teacher: string; status: RegistrationStatus; admin_note: string | null; created_at: Date; reviewed_at: Date | null }>(
    `select r.id, c.name as course, c.teacher, r.status, r.admin_note, r.created_at, r.reviewed_at
     from registrations r join courses c on c.id = r.course_id
     where r.student_id = $1 order by r.created_at desc`,
    [studentId]
  );
  return rows.map((r): StudentRegistration => ({ id: Number(r.id), course: r.course, teacher: r.teacher, status: r.status, adminNote: r.admin_note, createdAt: new Date(r.created_at), reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null }));
}
