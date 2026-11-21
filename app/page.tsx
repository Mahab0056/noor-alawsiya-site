import Image from 'next/image';
import Link from 'next/link';
import { CourseCard, TeacherGrid } from '@/components/Cards';
import { Icon } from '@/components/Icon';
import { JsonLd } from '@/components/JsonLd';
import { RegistrationCta } from '@/components/RegistrationState';
import { SiteFooter, SiteHeader } from '@/components/SiteChrome';
import { ar, CONTACT, countOf, COURSES, DONE_COURSES, HOME_COURSES, MAHFAL_COURSES, OPEN_COURSES, TEACHERS } from '@/lib/data';
import type { IconName } from '@/lib/icons';
import { SCHOOL_LD } from '@/lib/seo';

const STATS: { icon: IconName; value: number; label: string }[] = [
  { icon: 'book', value: COURSES.length, label: 'دورة منذ ٢٠٢١' },
  { icon: 'play', value: OPEN_COURSES.length, label: 'دورات قائمة الآن' },
  { icon: 'mic', value: TEACHERS.length, label: 'أستاذاً وقارئاً' },
  { icon: 'cert', value: DONE_COURSES.length, label: 'دورات تخرّجت' },
];

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'msg', title: 'راسل المدرسة', text: 'على واتساب، واذكر الدورة التي تريدها.' },
  { icon: 'list', title: 'عرّف بمستواك', text: 'يسألك الأستاذ أسئلة قصيرة عن تلاوتك.' },
  { icon: 'check', title: 'موافقة الإدارة', text: 'تبلّغك المدرسة بالقبول وبالحلقة المناسبة.' },
  { icon: 'pin', title: 'احضر حلقتك', text: 'في الجامع أو الحسينية في موعد الدورة.' },
];

const TIMELINE: [string, string][] = [
  ['٢٠٢١', 'انطلاق أولى الدورات: زين العابدين (ع)، خاتم المرسلين (ص)، والصديقة الكبرى (ع) للقراءة التحقيقية.'],
  ['٢٠٢٢', 'تخرّج دورة خاتم المرسلين (ص) بخمسة طلاب، وانطلاق دورة قطيع الكفين (ع) للنغم القرآني.'],
  ['٢٠٢٣', 'دورة الإمام الجواد (ع) للقراءة التحقيقية بالتعاون مع معهد القرآن الكريم، ودورتا قطيع الكفين (ع) وباب المراد لأحكام التلاوة والتجويد.'],
  ['٢٠٢٤', 'دورتا فاطمة الزهراء (ع) والحسن المجتبى (ع) في جناح حي طارق، ودورات أبي الفضل العباس (ع) للنغم، أئمة البقيع (ع)، والإمام المنتظر (عج).'],
  ['٢٠٢٥', 'إجازة خمسة قرّاء بقراءة عاصم الكوفي بعد اختبار مدير المدرسة، ثم محفل التخرّج في أيلول.'],
  ['٢٠٢٦', 'دورات سكينة (ع) والسيدة نرجس (ع)، ودورة النغم بالطريقة العراقية مع الشيخ عباس المنشداوي.'],
];

export default function Home() {
  return (
    <>
      <JsonLd data={SCHOOL_LD} />
      <SiteHeader current="home" />
      <main id="main">
        <section className="hero">
          <div className="wrap">
            <div>
              <span className="tag y">
                <i />
                مدرسة مستقلة منذ ٢٠٢٠
              </span>
              <h1 style={{ marginTop: 16 }}>
                تعلّم القرآن الكريم
                <br />
                <em>تلاوةً وتجويداً ونغماً</em>
              </h1>
              <p className="lead">حلقات في جوامع وحسينيات البلديات وحي طارق ومدينة الصدر، على يد قرّاء وأساتذة متخصصين، بإشراف الشيخ المقرئ قاسم الكناني.</p>
              <div className="acts">
                <Link className="btn y" href="/register">
                  سجّل الآن <Icon name="chev" size="s" />
                </Link>
                <Link className="btn g" href="/courses">
                  تصفّح الدورات
                </Link>
              </div>
              <div className="trust">
                <span>
                  <Icon name="book" size="s" />
                  أحكام التلاوة والتجويد
                </span>
                <span>
                  <Icon name="cert" size="s" />
                  القراءة التحقيقية والإجازة
                </span>
                <span>
                  <Icon name="mic" size="s" />
                  النغم القرآني
                </span>
              </div>
            </div>
            <div className="stage">
              <div className="arch">
                <Image src="/img/mushaf.jpg" alt="مصحف مفتوح على حامله في الجامع" fill sizes="(max-width: 900px) 84vw, 440px" quality={60} preload fetchPriority="high" />
              </div>
              <div className="float a">
                <span className="ic">
                  <Icon name="cal" />
                </span>
                <span>
                  <span className="mute">أحدث دورة</span>
                  <b>النغم بالطريقة العراقية</b>
                  الشيخ عباس المنشداوي
                </span>
              </div>
              <div className="float b">
                <span className="ic">
                  <Icon name="cert" />
                </span>
                <span>
                  <span className="mute">محفل التخرّج ٢٠٢٥</span>
                  <b>{countOf(MAHFAL_COURSES.length, 'دورات', 'دورة')} تخرّجت</b>
                  في ١٢ أيلول
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="wrap stats">
          <div className="card">
            {STATS.map((s) => (
              <div className="s" key={s.label}>
                <span className="ic">
                  <Icon name={s.icon} size="l" />
                </span>
                <div>
                  <b>{ar(s.value)}</b>
                  <span>{s.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <section className="sec">
          <div className="wrap">
            <div className="sec-h">
              <div>
                <p className="eye">الدورات القائمة</p>
                <h2>{countOf(OPEN_COURSES.length, 'دورات', 'دورة')} قائمة الآن</h2>
              </div>
            </div>
            <div className="g3">
              {HOME_COURSES.map((c) => (
                <CourseCard key={c.name} course={c} />
              ))}
            </div>
            <p style={{ textAlign: 'center', marginTop: 26 }}>
              <Link className="btn o" href="/courses">
                عرض سجل المدرسة كاملاً ({countOf(COURSES.length, 'دورات', 'دورة')}) <Icon name="chev" size="s" />
              </Link>
            </p>
          </div>
        </section>

        <section className="sec dark">
          <div className="wrap">
            <div className="sec-h">
              <div>
                <p className="eye">كيف تبدأ</p>
                <h2>
                  أربع خطوات <em>إلى حلقتك</em>
                </h2>
              </div>
            </div>
            <div className="steps">
              {STEPS.map((s) => (
                <div className="stp" key={s.title}>
                  <span className="n">
                    <Icon name={s.icon} size="l" />
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" style={{ paddingBottom: 0 }}>
          <div className="wrap">
            <div className="sec-h">
              <div>
                <p className="eye">سجل المدرسة</p>
                <h2>من ٢٠٢١ إلى اليوم: حلقات وتخرّج</h2>
              </div>
            </div>
            <div className="split even">
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="mh">
                  <span className="tag y">محفل التخرّج</span>
                  <h3>١٢ أيلول ٢٠٢٥</h3>
                  <p>بمناسبة ولادة النبي الأكرم محمد (ص) وحفيده الإمام الصادق (ع)، تخرّجت {countOf(MAHFAL_COURSES.length, 'دورات', 'دورة')} في محفل واحد.</p>
                </div>
                <div className="list">
                  {MAHFAL_COURSES.map((c) => (
                    <div className="li" key={c.name}>
                      <span className="av y" aria-hidden="true">
                        <Icon name="cert" size="s" />
                      </span>
                      <div>
                        <b>{c.name}</b>
                        <small>{c.teacher}</small>
                      </div>
                      {c.graduates ? (
                        <span className="sp">
                          <span className="tag">{c.graduates} متخرجين</span>
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              <div className="tl">
                {TIMELINE.map(([year, text]) => (
                  <div key={year}>
                    <b>{year}</b>
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="sec">
          <div className="wrap">
            <div className="sec-h">
              <div>
                <p className="eye">الأساتذة</p>
                <h2>{ar(TEACHERS.length)} أستاذاً وقارئاً</h2>
              </div>
            </div>
            <TeacherGrid />
          </div>
        </section>

        <section className="ayah">
          <p>﴿إِنَّ هَٰذَا الْقُرْآنَ يَهْدِي لِلَّتِي هِيَ أَقْوَمُ﴾</p>
          <span>سورة الإسراء · الآية ٩</span>
        </section>

        <section className="sec" style={{ paddingBottom: 0 }}>
          <div className="wrap">
            <div className="cta">
              <RegistrationCta />
              <div className="sp">
                <Link className="btn y" href="/register">
                  سجّل الآن
                </Link>
                <a className="btn g" href={CONTACT.whatsapp} target="_blank" rel="noopener noreferrer">
                  <Icon name="msg" size="s" />
                  واتساب
                </a>
                <a className="btn g" href={CONTACT.phoneHref}>
                  <Icon name="phone" size="s" />
                  <span className="num">{CONTACT.phone}</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
