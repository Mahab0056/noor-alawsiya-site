import { CONTACT } from './data';
import { courseSlug } from './share';
import { FACT_QUESTIONS, GAP_LABEL, WELCOME_FACTS, welcomeEnabled, type WelcomeFacts } from './welcome-config';

/**
 * The welcome page for an accepted family and the matching WhatsApp text. Pure: no database, no cookies.
 * Behind the WELCOME_PAGE flag (off unless it is exactly «1» or «true»).
 */

export { GAP_LABEL };

export { welcomeEnabled };

export const welcomePath = (slug: string) => `/welcome/${slug}`;

/** The welcome slug for a course name from the school record, or undefined (a course without a slug has no welcome page). */
export const welcomeSlugFor = (courseName: string) => courseSlug({ name: courseName });

export type WelcomeItem = { text: string; gap: boolean };
export type WelcomeSection = { id: string; title: string; items: WelcomeItem[] };

const say = (text: string): WelcomeItem => ({ text, gap: false });
const fact = (value: string | null | undefined, label: string): WelcomeItem => (value?.trim() ? say(`${label}: ${value.trim()}`) : { text: `${label}: ${GAP_LABEL}`, gap: true });

/** The six sections. `place` is the course's own place from the school record (courses.place), when it has one. */
export function welcomeSections(place: string | null, facts: WelcomeFacts = WELCOME_FACTS): WelcomeSection[] {
  const where = place?.trim() || facts.placeFallback;
  return [
    {
      id: 'when-where',
      title: 'موعد ومكان',
      items: [fact(facts.time, 'موعد الحلقة'), fact(where, 'مكان الحلقة'), say('تبلّغكم إدارة المدرسة بأي تغيير في الموعد أو المكان.')],
    },
    {
      id: 'bring',
      title: 'شتجيب وياك',
      items: facts.bring?.length ? facts.bring.map(say) : [{ text: `ما يحمله الطالب في أول يوم: ${GAP_LABEL}`, gap: true }],
    },
    {
      id: 'manners',
      title: 'الآداب',
      items: [
        say('نأتي إلى مجلس القرآن بسكينة ووقار، ونُنصت إلى القارئ وإلى الأستاذ حتى يُتمّ.'),
        say('نحترم الأستاذ وزملاءنا، ولا نرفع الصوت ولا نقاطع من يقرأ.'),
        say('نُغلق الهاتف أو نجعله صامتاً أثناء الحلقة.'),
        say('لا يُصوَّر أحد ولا يُنشر اسمه أو صورته إلا بإذنه، وبإذن وليّ أمره إن كان دون ١٨ سنة (كما في سياسة الخصوصية).'),
        fact(facts.dress, 'اللباس'),
      ],
    },
    {
      id: 'online',
      title: 'الدروس أونلاين',
      items: [
        say('إن كان للدورة درس مصوّر فيصلكم رابطه من إدارة المدرسة، وهو للطلاب المقبولين فقط، فلا تشاركوه مع غيرهم.'),
        say('الدرس المصوّر عونٌ على المراجعة ولا يغني عن الحضور والتلاوة بين يدي الأستاذ.'),
        fact(facts.lessonsLink, 'أين تجدون رابط الدرس'),
      ],
    },
    {
      id: 'attendance',
      title: 'الحضور والغياب',
      items: [say('الانتظام في الحضور أدبٌ مع القرآن ومع الأستاذ.'), say('إن تعذّر الحضور فأبلغوا الأستاذ أو الإدارة قبل الحلقة ما أمكن.'), fact(facts.absence, 'كيف يُبلَّغ بالغياب')],
    },
    {
      id: 'contact',
      title: 'تتواصل ويا منو',
      items: [fact(facts.contactPerson, 'المسؤول عن أسئلتكم')],
    },
  ];
}

/** The school's own public contact (already on every page of the site). */
export const CONTACT_LINES = { whatsapp: CONTACT.whatsapp, phone: CONTACT.phone, phoneHref: CONTACT.phoneHref };

/** Every fact the school still owes the page: the questions for `awsiya-school-questions`. Empty when the config is complete. */
export function welcomeGaps(facts: WelcomeFacts = WELCOME_FACTS): { key: keyof WelcomeFacts; question: string }[] {
  return (Object.keys(facts) as (keyof WelcomeFacts)[])
    .filter((k) => {
      const v = facts[k];
      return Array.isArray(v) ? v.length === 0 : !v?.trim();
    })
    .map((key) => ({ key, question: FACT_QUESTIONS[key] }));
}

export const WELCOME_MESSAGE_MAX = 600;

/**
 * The WhatsApp text for an accepted request, used by the admin's «إبلاغ» button only when the flag is on.
 * Gaps are left out (a family should not read «ينتظر المدرسة» in a chat). No name, no phone, no password.
 */
export function welcomeMessage(course: string, origin: string, slug: string, place: string | null = null, facts: WelcomeFacts = WELCOME_FACTS): string {
  const when = facts.time?.trim();
  const where = place?.trim() || facts.placeFallback?.trim();
  const lines = ['السلام عليكم ورحمة الله وبركاته،', `من مدرسة نور الأوصياء للدراسات القرآنية: يسرّنا إبلاغكم بقبول طلب التسجيل في «${course}». أهلاً بكم.`];
  if (when) lines.push(`الموعد: ${when}`);
  if (where) lines.push(`المكان: ${where}`);
  if (!when || !where) lines.push('تبلّغكم الإدارة بالموعد والمكان.');
  lines.push('نرجو الحضور بسكينة وأدب، وجعل الهاتف صامتاً أثناء الحلقة، واحترام الأستاذ والزملاء.');
  lines.push(`ما تحتاجونه في أول يوم وطريقة الدروس، بعد الدخول إلى حسابكم: ${origin}${welcomePath(slug)}`);
  return lines.join('\n');
}
