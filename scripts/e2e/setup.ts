/**
 * Invented data for the Server Action probes (scripts/e2e/actions-probe.mjs). Never run it against a real database.
 *
 *   DATABASE_URL=… APP_SECRET=… npm run seed
 *   DATABASE_URL=… APP_SECRET=… npx tsx --conditions=react-server scripts/e2e/setup.ts <tokens.json>
 *
 * Adds a super admin, a staff admin and two students (one adult, one minor), each with one pending request, and opens
 * two seeded courses. Sessions are made directly with createSession (no sign-in) and written, with the ids, to
 * <tokens.json> (mode 0600). They only open this throwaway database.
 */
import { writeFileSync } from 'node:fs';
import { createAdmin } from '../../lib/accounts';
import { createSession } from '../../lib/auth';
import { listCoursesForAdmin, setCourseAccepting } from '../../lib/courses';
import { getDb } from '../../lib/db';
import { listQuestions, register } from '../../lib/registration';

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: setup.ts <tokens.json>');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set: the probes run against the same Postgres as next start.');

  const db = await getDb();
  const [{ n }] = await db.query<{ n: number }>('select count(*)::int as n from admins');
  if (n > 0) throw new Error('This database already has admins. The probes need a fresh one (they change data).');

  const pw = 'invented-' + Math.random().toString(36).slice(2) + '-pass';
  const sup = (await createAdmin(db, { name: 'مدير تجريبي', email: 'super@example.test', password: pw, role: 'super_admin' })).adminId;
  const staff = (await createAdmin(db, { name: 'مشرف تجريبي', email: 'staff@example.test', password: pw, role: 'staff' })).adminId;

  const open = (await listCoursesForAdmin(db)).filter((c) => c.status === 'open').slice(0, 2);
  if (open.length < 2) throw new Error('Run `npm run seed` first: the probes need two running courses.');
  for (const c of open) await setCourseAccepting(db, sup, c.id, true);

  const answers: Record<string, string> = {};
  for (const q of await listQuestions(db)) {
    if (q.required && !q.showIf) answers[String(q.id)] = q.kind === 'yes_no' ? 'لا' : q.kind === 'text' ? 'جواب تجريبي' : q.options[0];
  }
  const regs = [];
  for (const [i, name] of ['علي حسن كاظم', 'زينب محمد جواد'].entries()) {
    const r = await register(db, {
      fullName: name, birthYear: i ? '2012' : '1999', phone: `0770123000${i}`, password: 'student-pass-' + i,
      guardianName: i ? 'محمد جواد علي' : '', guardianPhone: i ? '07801230009' : '', guardianConsent: !!i,
      courseId: String(open[0].id), answers,
    });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    regs.push(r);
  }

  const tok = async (kind: 'admin' | 'student', id: number) => (await createSession(db, kind, id)).token;
  const tokens = {
    super: await tok('admin', sup),
    staff: await tok('admin', staff),
    studentA: await tok('student', regs[0].studentId),
    studentB: await tok('student', regs[1].studentId),
    ids: {
      sup, staff, studentA: regs[0].studentId, studentB: regs[1].studentId,
      regA: regs[0].registrationId, regB: regs[1].registrationId, openCourses: open.map((c) => c.id),
    },
  };
  writeFileSync(out, JSON.stringify(tokens), { mode: 0o600 });
  console.log(`e2e setup: ${open.length} courses open, 2 students, 2 admins`);
  await db.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
