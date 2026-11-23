import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Fragment, Suspense } from 'react';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { CONTACT } from '@/lib/data';
import { progressEnabled } from '@/lib/flags';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية',
  description: 'ما البيانات التي يجمعها موقع مدرسة نور الأوصياء، ولماذا، وكيف تُحفظ وتُحذف.',
};

// Only while «المتابعة» is on (lib/flags.ts): the site then also keeps attendance and a teacher's note per session.
const PROGRESS_ITEM = 'بعد قبول الطالب في دورة: حضوره في كل حلقة (حاضر أو غائب أو مجاز) وملاحظة قصيرة من الأستاذ عن الدرس، يراها الطالب وولي أمره في «حسابي».';

const BASE_SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'ما الذي نجمعه عند التسجيل',
    items: [
      'أقل ما يلزم: الاسم، سنة الميلاد (السنة فقط)، ورقم الهاتف، مع إجابات استبيان قصير عن مستواك في التلاوة.',
      'لا نطلب صوراً شخصية ولا عنوان سكن ولا وثائق.',
      'من هو دون ١٨ سنة يُسجَّل باسم ولي الأمر ورقمه وموافقته.',
      'تصفّح صفحات الموقع لا يحتاج حساباً ولا يطلب منك أي بيانات.',
    ],
  },
  {
    title: 'كيف نحفظ بياناتك',
    items: [
      'كلمة المرور لا تُحفظ كما كتبتها، بل بصيغة مشفّرة لا يستطيع أحد قراءتها، حتى إدارة المدرسة.',
      'نستخدم ملف تعريف واحداً (كوكي) لإبقائك داخل حسابك فقط، ولا نستخدم أدوات تتبّع أو إعلانات.',
      'لحماية الحسابات من التخمين نحفظ محاولات الدخول (رقم الهاتف وعنوان الاتصال) يوماً واحداً ثم تُحذف.',
      'دخول الإدارة محمي بكلمة مرور ورمز تحقق، وكل قبول أو رفض لطلب يُسجَّل باسم من قام به.',
    ],
  },
  {
    title: 'من يرى بياناتك',
    items: [
      'إدارة المدرسة والأستاذ المسؤول عن دورتك فقط.',
      'لا نبيع البيانات ولا نشاركها مع أي جهة خارج المدرسة.',
      'لا تُنشر أسماء الطلاب أو صورهم في الموقع إلا بموافقتهم، وموافقة ولي الأمر لمن هو دون ١٨ سنة.',
    ],
  },
  {
    title: 'حقوقك',
    items: ['لك أن تطلب الاطلاع على بياناتك أو تصحيحها أو حذفها في أي وقت.', 'لولي الأمر الحق نفسه عن ابنه أو ابنته.'],
  },
];

/**
 * The progress line follows the flag of the running server. With cacheComponents a page that reads nothing per request
 * is prerendered once at build time, so without connection() the line would show whatever PROGRESS_TRACKING the build
 * had (review awsiya-review-progress-build-2220r, M1). Only this line is per request; the rest of the page stays static.
 */
async function ProgressItem() {
  await connection();
  return progressEnabled() ? <li>{PROGRESS_ITEM}</li> : null;
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader current="privacy" />
      <main id="main">
        <section className="phead">
          <div className="wrap">
            <p className="eye">مدرسة نور الأوصياء</p>
            <h1>سياسة الخصوصية</h1>
            <p>نحرص على أن نجمع أقل قدر من البيانات، وخصوصاً أن بين طلابنا من هم دون ١٨ سنة.</p>
          </div>
        </section>
        <section className="sec" style={{ paddingTop: 40, paddingBottom: 0 }}>
          <div className="wrap prose">
            {BASE_SECTIONS.map((s, i) => (
              <div className="card pad" key={s.title}>
                <h2>{s.title}</h2>
                <ul>
                  {s.items.map((item, j) => (
                    <Fragment key={item}>
                      {i === 0 && j === 3 ? (
                        <Suspense fallback={null}>
                          <ProgressItem />
                        </Suspense>
                      ) : null}
                      <li>{item}</li>
                    </Fragment>
                  ))}
                </ul>
              </div>
            ))}
            <div className="card pad">
              <h2>للتواصل بخصوص بياناتك</h2>
              <p>
                راسل إدارة المدرسة على{' '}
                <a href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                  واتساب
                </a>{' '}
                أو اتصل على{' '}
                <a className="num" href={CONTACT.phoneHref}>
                  {CONTACT.phone}
                </a>
                .
              </p>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
