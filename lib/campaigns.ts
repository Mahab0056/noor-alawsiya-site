import 'server-only';
import { audit } from './admin';
import { campaignUrl, cleanName, isTarget, nameError, type CampaignTarget } from './campaign-links';
import type { Db } from './db';

/**
 * «روابط الحملات» (/admin/campaigns): super admins make a link with `?from=<name>` and a QR code for posters, mosque
 * boards and the Instagram bio. Rules for names and links: lib/campaign-links.ts. QR images: lib/campaign-qr.ts.
 *
 * Super admins only. The page, the Server Action and the QR download all call requireSuperAdmin() (lib/session.ts), and
 * addCampaignLink checks the role again against the database, as lib/invites.ts does. Nothing about visitors is stored;
 * who made a link is in audit_log by link id only.
 *
 * Numbers per link (FUNNEL_COUNTS on): lib/funnel.ts counts a `?from=` name only when it is a row of this table
 * (anything else is «other»), and the page reads them with countsByLink(). Off: the page keeps its «لاحقاً» line.
 */

export type CampaignErrors = Partial<Record<'name' | 'target' | 'course', string>>;
export type CampaignInput = { name: string; target: string; courseId: string };
export type CampaignLink = {
  id: number;
  name: string;
  target: CampaignTarget;
  courseId: number | null;
  courseName: string | null;
  /** The course takes registrations now (published and open). Null for links that do not name a course. */
  courseAccepting: boolean | null;
  url: string;
  createdAt: Date;
};

export class CampaignError extends Error {
  constructor(public code: 'not-super') {
    super(code);
  }
}

/** Checked again here, against the database, so a stale session of a demoted admin cannot make links. */
async function assertSuperAdmin(db: Db, actorId: number) {
  const [row] = await db.query<{ role: string }>('select role from admins where id = $1 and activated_at is not null and disabled_at is null', [actorId]);
  if (row?.role !== 'super_admin') throw new CampaignError('not-super');
}

export function validateCampaign(input: CampaignInput): { ok: true; value: { name: string; target: CampaignTarget; courseId: number | null } } | { ok: false; errors: CampaignErrors } {
  const errors: CampaignErrors = {};
  const name = cleanName(input.name);
  const bad = nameError(name);
  if (bad) errors.name = bad;
  const target = isTarget(input.target) ? input.target : null;
  if (!target) errors.target = 'اختر الصفحة التي يفتحها الرابط.';
  let courseId: number | null = null;
  if (target === 'course') {
    const n = Number(input.courseId);
    if (input.courseId.trim() === '' || !Number.isSafeInteger(n) || n <= 0) errors.course = 'اختر الدورة.';
    else courseId = n;
  }
  if (Object.keys(errors).length > 0 || !target) return { ok: false, errors };
  return { ok: true, value: { name, target, courseId } };
}

export type AddResult = { ok: true; id: number } | { ok: false; errors: CampaignErrors };

/** Validates, refuses a name already used, and records the link. Throws CampaignError('not-super') for anyone else. */
export async function addCampaignLink(db: Db, actorId: number, input: CampaignInput): Promise<AddResult> {
  await assertSuperAdmin(db, actorId);
  const checked = validateCampaign(input);
  if (!checked.ok) return checked;
  const { name, target, courseId } = checked.value;
  if (courseId !== null) {
    const [c] = await db.query<{ status: string }>('select status from courses where id = $1', [courseId]);
    if (!c) return { ok: false, errors: { course: 'هذه الدورة غير موجودة.' } };
    if (c.status === 'done') return { ok: false, errors: { course: 'هذه الدورة منتهية. اختر دورة قائمة.' } };
  }
  const taken = { ok: false as const, errors: { name: 'هذا الاسم مستعمل لرابط آخر. كل رابط يحتاج اسماً خاصاً به حتى يُعدّ وحده.' } };
  const [exists] = await db.query('select 1 from campaign_links where name = $1', [name]);
  if (exists) return taken;
  try {
    const [row] = await db.query<{ id: string }>('insert into campaign_links (name, target, course_id) values ($1, $2, $3) returning id', [name, target, courseId]);
    const id = Number(row.id);
    await audit(db, actorId, 'campaign.added', `campaign:${id}`);
    return { ok: true, id };
  } catch (e) {
    // Two admins typing the same name at the same moment: the unique index decides.
    if ((e as { code?: string }).code === '23505') return taken;
    throw e;
  }
}

type LinkRow = { id: string; name: string; target: CampaignTarget; course_id: string | null; course_name: string | null; accepting: boolean | null; created_at: Date };

const SELECT = `select l.id, l.name, l.target, l.course_id, c.name as course_name,
                       case when c.id is null then null else (c.published and c.status = 'open') end as accepting, l.created_at
                  from campaign_links l left join courses c on c.id = l.course_id`;

const toLink = (r: LinkRow): CampaignLink => {
  const courseId = r.course_id === null ? null : Number(r.course_id);
  return { id: Number(r.id), name: r.name, target: r.target, courseId, courseName: r.course_name, courseAccepting: r.accepting, url: campaignUrl(r.target, r.name, courseId), createdAt: new Date(r.created_at) };
};

/** Newest first. */
export async function listCampaignLinks(db: Db): Promise<CampaignLink[]> {
  return (await db.query<LinkRow>(`${SELECT} order by l.id desc limit 500`)).map(toLink);
}

export async function getCampaignLink(db: Db, id: number): Promise<CampaignLink | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const [r] = await db.query<LinkRow>(`${SELECT} where l.id = $1`, [id]);
  return r ? toLink(r) : null;
}

/** Courses a link can point at: every course that is not finished, those taking registrations first. */
export async function campaignCourses(db: Db): Promise<{ id: number; name: string; accepting: boolean }[]> {
  const rows = await db.query<{ id: string; name: string; accepting: boolean }>(
    `select id, name, (published and status = 'open') as accepting from courses where status <> 'done' order by (published and status = 'open') desc, id desc`
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name, accepting: r.accepting }));
}
