import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { InviteAdminForm, RowAction } from '@/components/TeamForms';
import { countRequests } from '@/lib/admin';
import { getDb } from '@/lib/db';
import { formatDate } from '@/lib/format';
import { listAdmins, type AdminListRow } from '@/lib/invites';
import { requireSuperAdmin } from '@/lib/session';

export const metadata: Metadata = { title: 'المشرفون', robots: { index: false, follow: false } };

export default function AdminsPage() {
  return (
    <Suspense fallback={null}>
      <Team />
    </Suspense>
  );
}

const ROLE: Record<AdminListRow['role'], string> = { super_admin: 'مدير أعلى', owner: 'مشرف', staff: 'مشرف' };
const STATUS: Record<AdminListRow['status'], { label: string; tag: string }> = {
  active: { label: 'مفعّل', tag: 'ok' },
  pending: { label: 'بانتظار قبول الدعوة', tag: 'warn' },
  disabled: { label: 'موقوف', tag: 'bad' },
};

async function Team() {
  const admin = await requireSuperAdmin();
  const db = await getDb();
  const [admins, counts] = await Promise.all([listAdmins(db), countRequests(db)]);

  return (
    <AdminShell admin={admin} current="admins" pending={counts.pending}>
      <div className="ph">
        <div>
          <h1>المشرفون</h1>
          <p>من يدخل لوحة الإدارة. كل مشرف يكتب اسمه بنفسه من رابط الدعوة، ثم يدخل برمز يصل إلى بريده في كل مرة.</p>
        </div>
      </div>
      <div className="row">
        <div className="card">
          <table className="st team" role="table">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader">المشرف</th>
                <th role="columnheader">الحالة</th>
                <th role="columnheader"><span className="vh">إجراءات</span></th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {admins.map((a) => (
                <tr role="row" key={a.id}>
                  <td role="cell">
                    <b>{a.name || '—'}</b>
                    <br />
                    <small className="num mute">{a.email}</small> · <small>{ROLE[a.role]}</small>
                  </td>
                  <td role="cell">
                    <span className={`tag ${STATUS[a.status].tag}`}>{STATUS[a.status].label}</span>
                    {a.status === 'pending' ? (
                      <small className="mute"> {a.inviteExpiresAt && a.inviteExpiresAt > new Date() ? `الرابط يصلح حتى ${formatDate(a.inviteExpiresAt)}` : 'لا رابط صالح'}</small>
                    ) : null}
                    {a.locked && a.status === 'active' ? <small className="mute"> · محاولات دخول فاشلة حديثة</small> : null}
                  </td>
                  <td role="cell">
                    {a.id === admin.id ? (
                      <span className="mute">حسابك</span>
                    ) : (
                      <div className="tacts" style={{ flexWrap: 'wrap' }}>
                        {a.status === 'pending' ? <RowAction kind="resend" id={a.id} label="إعادة إرسال" /> : null}
                        {a.status === 'pending' && a.inviteExpiresAt ? <RowAction kind="revoke" id={a.id} label="سحب الدعوة" danger /> : null}
                        {a.status === 'active' && a.locked ? <RowAction kind="unlock" id={a.id} label="فك القفل" /> : null}
                        {a.status === 'active' ? (
                          <RowAction kind="resend" id={a.id} extra={{ reset: '1' }} label="إعادة دعوة (رابط جديد)" danger />
                        ) : null}
                        {a.status !== 'pending' ? (
                          <RowAction kind="disable" id={a.id} extra={{ disabled: a.status === 'disabled' ? '0' : '1' }} label={a.status === 'disabled' ? 'إعادة تفعيل' : 'إيقاف'} danger={a.status !== 'disabled'} />
                        ) : null}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="qfoot mute">
            «فك القفل» يمسح محاولات الدخول الفاشلة الأخيرة لهذا المشرف فيستطيع المحاولة فوراً بدل انتظار ربع ساعة. «إعادة دعوة» تُنهي جلساته ورموزه وترسل رابطاً جديداً، ولا يدخل حتى يفتحه.
          </p>
        </div>
        <div className="card q">
          <h2 className="qh">دعوة مشرف</h2>
          <InviteAdminForm />
        </div>
      </div>
    </AdminShell>
  );
}
