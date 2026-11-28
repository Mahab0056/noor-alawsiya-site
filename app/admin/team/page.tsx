import type { Metadata } from 'next';
import { Suspense } from 'react';
import { removeAdminAction } from '@/app/admin/team/actions';
import { AdminShell } from '@/components/AdminShell';
import { TeamForm } from '@/components/TeamForm';
import { countRequests } from '@/lib/admin';
import { ar, countOf } from '@/lib/data';
import { getDb } from '@/lib/db';
import { requireAdmin } from '@/lib/session';
import { listTeam } from '@/lib/team';

export const metadata: Metadata = { title: 'المشرفون', robots: { index: false, follow: false } };

export default function AdminTeamPage() {
  return (
    <Suspense fallback={null}>
      <Team />
    </Suspense>
  );
}

async function Team() {
  const admin = await requireAdmin();
  const db = await getDb();
  const [team, counts] = await Promise.all([listTeam(db), countRequests(db)]);

  return (
    <AdminShell admin={admin} current="team" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>المشرفون</h1>
          <p>كل مشرف هنا مشرف عام: يراجع الطلبات، ويعدّل الاستبيان والمعرض، ويضيف المشرفين ويحذفهم.</p>
        </div>
      </div>
      <div className="row">
        <div className="card">
          <div className="ch">
            <h2>{countOf(team.length, 'مشرفين', 'مشرف')}</h2>
          </div>
          <ol className="qlist">
            {team.map((m, i) => (
              <li className="qrow" key={m.id}>
                <span className="qn">{ar(i + 1)}</span>
                <div>
                  <b>{m.name}</b>
                  <div className="qmeta">
                    <span className="tag y">مشرف عام</span>
                    <span className="mute" dir="ltr">
                      {m.email}
                    </span>
                    {m.id === admin.id ? <span className="tag">أنت</span> : null}
                    {m.lastLoginAt ? null : <span className="mute">لم يدخل بعد</span>}
                  </div>
                </div>
                {m.id === admin.id ? null : (
                  <div className="sp">
                    <form action={removeAdminAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn sm no" aria-label={`حذف المشرف ${m.name}`}>
                        حذف
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="qfoot mute">حذف المشرف ينهي جلساته فوراً. لا يحذف أحد حسابه هو، فتبقى اللوحة دائماً بمشرف واحد على الأقل.</p>
        </div>
        <div className="card q">
          <h2 className="qh">مشرف جديد</h2>
          <TeamForm />
        </div>
      </div>
    </AdminShell>
  );
}
