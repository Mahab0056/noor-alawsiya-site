import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { CONTACT } from '@/lib/data';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية',
  description: 'ما البيانات التي يجمعها موقع مدرسة نور الأوصياء، ولماذا، وكيف تُحفظ وتُحذف.',
};

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'ما الذي يجمعه الموقع الآن',
    items: [
      'الموقع الحالي صفحات تعريفية فقط: لا حسابات، لا نماذج تسجيل، ولا يطلب منك أي بيانات.',
      'التسجيل يتم حالياً عبر واتساب أو الهاتف مباشرة مع إدارة المدرسة، وما ترسله هناك يبقى بينك وبينها.',
    ],
  },
  {
    title: 'عند فتح التسجيل من الموقع',
    items: [
      'سنطلب أقل ما يلزم: الاسم، سنة الميلاد، ورقم الهاتف، مع إجابات استبيان قصير عن مستواك في التلاوة.',
      'لا نطلب صوراً شخصية ولا عنوان سكن ولا وثائق.',
      'من هو دون ١٨ سنة يُسجَّل برقم ولي الأمر وموافقته.',
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

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader current="privacy" />
      <main>
        <section className="phead">
          <div className="wrap">
            <p className="eye">مدرسة نور الأوصياء</p>
            <h1>سياسة الخصوصية</h1>
            <p>نحرص على أن نجمع أقل قدر من البيانات، وخصوصاً أن بين طلابنا من هم دون ١٨ سنة.</p>
          </div>
        </section>
        <section className="sec" style={{ paddingTop: 40, paddingBottom: 0 }}>
          <div className="wrap prose">
            {SECTIONS.map((s) => (
              <div className="card pad" key={s.title}>
                <h2>{s.title}</h2>
                <ul>
                  {s.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="card pad">
              <h2>للتواصل بخصوص بياناتك</h2>
              <p>
                راسل إدارة المدرسة على{' '}
                <a href={CONTACT.whatsapp} target="_blank" rel="noopener">
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
