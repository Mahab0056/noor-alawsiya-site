/**
 * Fills an empty database with the school's courses (registration closed: open it per course in /admin/courses)
 * and a starter questionnaire.
 * Safe to run again: each part is skipped when its table already has rows.
 *
 *   npm run seed            courses + starter questionnaire
 *   npm run seed -- --demo  also adds invented students and a demo admin (local PGlite only)
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAdmin } from '../lib/accounts';
import { reviewRequest } from '../lib/admin';
import { COURSES } from '../lib/data';
import { getDb } from '../lib/db';
import { listOpenCourses, listQuestions, register } from '../lib/registration';

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

async function main() {
  const demo = process.argv.includes('--demo');
  if (demo && process.env.DATABASE_URL) throw new Error('--demo is for the local PGlite database only. Unset DATABASE_URL.');
  const db = await getDb();

  const [{ n: courseCount }] = await db.query<{ n: string }>('select count(*) as n from courses');
  if (Number(courseCount) === 0) {
    for (const c of COURSES) {
      // Unpublished: the record's 'open' means «still running», not «takes new students». A super admin opens
      // registration course by course in /admin/courses. The local --demo data opens them all, to have something to look at.
      await db.query('insert into courses (name, kind, description, teacher, place, started_on, status, published) values ($1, $2, $3, $4, $5, $6, $7, $8)', [
        c.name, c.kind, c.kindLabel, c.teacher, c.place, c.start, c.status, demo,
      ]);
    }
    console.log(`courses: added ${COURSES.length}${demo ? '' : ' (registration closed: a super admin opens it per course in /admin/courses)'}`);
  } else console.log('courses: already present, skipped');

  const [{ n: questionCount }] = await db.query<{ n: string }>('select count(*) as n from form_questions');
  if (Number(questionCount) === 0) {
    const add = async (position: number, label: string, kind: string, options: string[], required: boolean, showIf: object | null = null) => {
      const [row] = await db.query<{ id: string }>('insert into form_questions (label, kind, options, required, position, show_if) values ($1, $2, $3, $4, $5, $6) returning id', [
        label, kind, JSON.stringify(options), required, position, showIf ? JSON.stringify(showIf) : null,
      ]);
      return Number(row.id);
    };
    await add(1, 'ما مستوى الطالب الحالي في تلاوة القرآن الكريم؟', 'single', ['مبتدئ، يتهجّى الكلمات', 'يقرأ بطلاقة بلا أحكام التجويد', 'يتقن أحكام التجويد'], true);
    const before = await add(2, 'هل درس الطالب في دورة قرآنية من قبل؟', 'yes_no', [], true);
    await add(3, 'اذكر اسم الدورة السابقة ومكانها', 'text', [], false, { question_id: before, equals: 'نعم' });
    await add(4, 'ما الأيام المناسبة للحضور؟', 'multi', DAYS, false);
    console.log('questionnaire: added 4 starter questions');
  } else console.log('questionnaire: already present, skipped');

  if (demo) await seedDemo();
  await db.close();
}

/** Invented people only, for looking at the screens on this machine. */
async function seedDemo() {
  const db = await getDb();
  const [{ n }] = await db.query<{ n: string }>('select count(*) as n from students');
  if (Number(n) > 0) return console.log('demo: students already present, skipped');

  const courses = await listOpenCourses(db);
  const questions = await listQuestions(db);
  const [level, before, where, days] = questions;
  const password = randomBytes(12).toString('base64url');
  const year = new Date().getFullYear();
  const people = [
    { n: 'طالب تجريبي الأول', age: 16, level: 1, before: 'نعم', days: ['السبت', 'الثلاثاء'] },
    { n: 'طالب تجريبي الثاني', age: 24, level: 0, before: 'لا', days: ['الجمعة'] },
    { n: 'طالب تجريبي الثالث', age: 19, level: 2, before: 'نعم', days: ['الأحد', 'الخميس'] },
    { n: 'طالب تجريبي الرابع', age: 31, level: 1, before: 'لا', days: [] },
    { n: 'طالب تجريبي الخامس', age: 13, level: 0, before: 'لا', days: ['الجمعة', 'السبت'] },
    { n: 'طالب تجريبي السادس', age: 22, level: 1, before: 'لا', days: ['الاثنين'] },
  ];
  const ids: number[] = [];
  for (const [i, p] of people.entries()) {
    const minor = p.age <= 18;
    const result = await register(db, {
      fullName: p.n,
      birthYear: String(year - p.age),
      phone: `0770000000${i + 1}`,
      password,
      guardianName: minor ? 'ولي أمر تجريبي' : '',
      guardianPhone: minor ? '07700000099' : '',
      guardianConsent: minor,
      courseId: String(courses[i % courses.length].id),
      answers: {
        [level.id]: level.options[p.level],
        [before.id]: p.before,
        ...(p.before === 'نعم' ? { [where.id]: 'دورة تجويد في جامع المنطقة' } : {}),
        [days.id]: p.days,
      },
    });
    if (!result.ok) throw new Error(`demo student ${i + 1}: ${JSON.stringify(result.errors)}`);
    ids.push(result.registrationId);
  }

  const email = 'admin@noor.test';
  const adminPassword = randomBytes(15).toString('base64url');
  const { adminId, totpSecret } = await createAdmin(db, { name: 'مدير تجريبي', email, password: adminPassword, role: 'owner' });
  await reviewRequest(db, adminId, ids[3], 'accepted', 'أهلاً بك. الحلقة يوم الجمعة بعد صلاة العصر.');
  await reviewRequest(db, adminId, ids[5], 'rejected', 'اكتمل عدد هذه الحلقة. سنتواصل معك عند فتح حلقة جديدة.');

  // Written next to the local database, which git ignores. Never printed.
  const dir = path.resolve(process.env.PGLITE_DIR ?? '.pglite');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'demo-credentials.json');
  writeFileSync(file, JSON.stringify({ admin: { email, password: adminPassword, totpSecret }, students: { phones: '07700000001 … 07700000006', password } }, null, 2));
  console.log(`demo: 6 invented students and a demo admin added. Credentials are in ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
