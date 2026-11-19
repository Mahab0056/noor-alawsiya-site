import Image from 'next/image';
import Link from 'next/link';
import { Icon } from './Icon';
import { CONTACT } from '@/lib/data';

type NavKey = 'home' | 'courses' | 'privacy';

const NAV: { key: NavKey; href: string; label: string }[] = [
  { key: 'home', href: '/', label: 'الرئيسية' },
  { key: 'courses', href: '/courses', label: 'الدورات والأساتذة' },
];

const EXT = { target: '_blank', rel: 'noopener noreferrer' } as const;

export function Logo({ mark = 'black', sub = 'للدراسات القرآنية' }: { mark?: 'black' | 'yellow'; sub?: string }) {
  return (
    <Link className="logo" href="/">
      <Image src={`/img/mark-${mark}.png`} alt="" width={37} height={48} />
      <span>
        نور الأوصياء<small>{sub}</small>
      </span>
    </Link>
  );
}

export function SiteHeader({ current }: { current?: NavKey }) {
  return (
    <>
      <a className="skip" href="#main">
        تخطَّ إلى المحتوى
      </a>
      <aside className="strip" aria-label="معلومات سريعة عن المدرسة">
        <div className="wrap">
          <span>
            <Icon name="pin" size="s" />
            بغداد · البلديات وحي طارق
          </span>
          <a className="hm" href={CONTACT.phoneHref}>
            <span>
              <Icon name="phone" size="s" />
              <span className="num">{CONTACT.phone}</span>
            </span>
          </a>
          <span className="sp">التسجيل مفتوح للدورات الحالية</span>
        </div>
      </aside>
      <header className="nav">
        <div className="wrap">
          <Logo />
          <nav aria-label="أقسام الموقع">
            {NAV.map((n) => (
              <Link key={n.key} href={n.href} className={n.key === current ? 'on' : undefined} aria-current={n.key === current ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
            <a href="#contact">تواصل</a>
            <Link href="/login">دخول الطلاب</Link>
          </nav>
          <div className="acts">
            <Link className="btn k sm" href="/register">
              سجّل الآن
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="foot" id="contact">
      <div className="wrap">
        <div className="cols">
          <div>
            <Logo mark="yellow" />
            <p>مدرسة مستقلة غير تابعة لأي جهة، تهدف إلى نشر علوم القرآن وأهل البيت عليهم السلام.</p>
          </div>
          <div>
            <h3>المدرسة</h3>
            <Link href="/">الرئيسية</Link>
            <Link href="/courses">الدورات والأساتذة</Link>
            <Link href="/register">التسجيل</Link>
            <Link href="/login">دخول الطلاب</Link>
            <Link href="/privacy">سياسة الخصوصية</Link>
          </div>
          <div>
            <h3>تابعنا</h3>
            <a href={CONTACT.youtube} {...EXT}>
              يوتيوب
            </a>
            <a href={CONTACT.facebook} {...EXT}>
              فيسبوك
            </a>
            <a href={CONTACT.instagram} {...EXT}>
              إنستغرام
            </a>
          </div>
          <div>
            <h3>تواصل</h3>
            <a className="num" href={CONTACT.phoneHref}>
              {CONTACT.phone}
            </a>
            <a href={CONTACT.whatsapp} {...EXT}>
              واتساب
            </a>
            <span>بغداد · البلديات وحي طارق</span>
          </div>
        </div>
        <div className="end">
          <span>مدرسة نور الأوصياء للدراسات القرآنية · تأسست ١٥ جمادى الأولى ١٤٤٢ هـ</span>
          <Link href="/privacy">سياسة الخصوصية</Link>
        </div>
      </div>
    </footer>
  );
}
