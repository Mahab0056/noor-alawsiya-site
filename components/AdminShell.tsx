import Link from 'next/link';
import type { ReactNode } from 'react';
import { adminLogoutAction } from '@/app/admin/actions';
import type { AdminProfile } from '@/lib/accounts';
import { ar } from '@/lib/data';
import { adminTotpEnabled } from '@/lib/flags';
import { Icon } from './Icon';
import { Logo } from './SiteChrome';

type Key = 'requests' | 'courses' | 'waitlist' | 'form' | 'admins';

/** Side navigation and top bar around every admin screen. Lists only the screens that exist. */
export function AdminShell({ admin, current, pending, children }: { admin: AdminProfile; current: Key; pending: number; children: ReactNode }) {
  const links = (
    <>
      <Link href="/admin" className={current === 'requests' ? 'on' : undefined} aria-current={current === 'requests' ? 'page' : undefined}>
        <Icon name="inbox" />
        طلبات التسجيل
        {pending > 0 ? <b>{ar(pending)}</b> : null}
      </Link>
      {admin.role === 'super_admin' ? (
        <Link href="/admin/courses" className={current === 'courses' ? 'on' : undefined} aria-current={current === 'courses' ? 'page' : undefined}>
          <Icon name="book" />
          الدورات
        </Link>
      ) : null}
      <Link href="/admin/waitlist" className={current === 'waitlist' ? 'on' : undefined} aria-current={current === 'waitlist' ? 'page' : undefined}>
        <Icon name="bell" />
        قائمة الانتظار
      </Link>
      <Link href="/admin/form" className={current === 'form' ? 'on' : undefined} aria-current={current === 'form' ? 'page' : undefined}>
        <Icon name="list" />
        استبيان التسجيل
      </Link>
      {admin.role === 'super_admin' ? (
        <Link href="/admin/admins" className={current === 'admins' ? 'on' : undefined} aria-current={current === 'admins' ? 'page' : undefined}>
          <Icon name="users" />
          المشرفون
        </Link>
      ) : null}
    </>
  );
  return (
    <div className="app">
      <aside className="side">
        <Logo mark="yellow" sub="لوحة الإدارة" />
        <nav aria-label="أقسام لوحة الإدارة">{links}</nav>
        <div className="me">
          <span className="av y" aria-hidden="true">
            {admin.name.trim()[0]}
          </span>
          <div>
            <b>{admin.name}</b>
            <br />
            <span>{adminTotpEnabled() ? 'تحقق بخطوتين مفعّل' : 'الدخول برمز البريد'}</span>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="mtop">
            <Logo sub="لوحة الإدارة" />
          </div>
          <form className="sp" action={adminLogoutAction}>
            <button className="btn w sm" type="submit">
              تسجيل الخروج
            </button>
          </form>
        </header>
        <nav className="mnav" aria-label="أقسام لوحة الإدارة">
          {links}
        </nav>
        <main className="body" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
