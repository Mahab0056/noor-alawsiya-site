// سجل دورات وأساتذة مدرسة نور الأوصياء.
// المصدر: سجل المدرسة الذي أرسله مهاب في 18/11/2026. المكرر مدموج.
// null = معلومة ناقصة في السجل، تُعرض «غير مذكور» ولا تُخترع.
// أسماء الطلبة المتخرجين غير مخزّنة هنا عمداً: نشرها يحتاج موافقة المدرسة.

export type CourseKind = 'tajweed' | 'tahqiq' | 'nagham';
export type CourseStatus = 'open' | 'done' | 'unknown';

export type Course = {
  name: string;
  kind: CourseKind | null;
  kindLabel: string | null;
  teacher: string;
  place: string | null;
  start: string | null;
  status: CourseStatus;
  note: string | null;
  graduates: string | null;
};

export type Teacher = { name: string; title: string; specialty: string | null };

export const KIND_TAG: Record<CourseKind, string> = { tajweed: 'تجويد', tahqiq: 'قراءة تحقيقية', nagham: 'نغم' };

export const COURSES: Course[] = [
  { name: "دورة نغمية بالطريقة العراقية", kind: "nagham", kindLabel: "النغم القرآني", teacher: "الشيخ عباس المنشداوي", place: "جامع وحسينية الإمام السجاد (ع)، البلديات", start: "٢٦ أيلول ٢٠٢٦", status: "open", note: null, graduates: null },
  { name: "دورة السيدة نرجس (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ علاء", place: "جامع الإمام علي (ع)، البلديات", start: "٣ أيار ٢٠٢٦", status: "open", note: null, graduates: null },
  { name: "دورة غير مسمّاة في السجل", kind: null, kindLabel: null, teacher: "الشيخ أبو مصطفى الدراجي، الأستاذ يوسف طالب", place: "جامع وحسينية الإمام السجاد (ع)، البلديات", start: "٣ أيار ٢٠٢٦", status: "open", note: null, graduates: null },
  { name: "دورة سكينة بنت الإمام الحسين (ع)", kind: "tahqiq", kindLabel: "القراءة التحقيقية", teacher: "الأستاذ ضياء اللامي", place: "حسينية أئمة البقيع (ع)، البلديات، شارع الشريط", start: "١ أيار ٢٠٢٦", status: "open", note: null, graduates: null },
  { name: "دورة قطيع الكفين (ع) النغمية الثانية", kind: "nagham", kindLabel: "النغم القرآني", teacher: "الأستاذ علاء زامل الدراجي", place: "جامع وحسينية الإمام السجاد (ع)، البلديات", start: "٧ تشرين الأول ٢٠٢٥", status: "open", note: null, graduates: null },
  { name: "دورة الرسول الأكرم محمد (ص)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ أحمد حنش الذهبي", place: "حي طارق", start: "٩ أيلول ٢٠٢٥", status: "open", note: null, graduates: null },
  { name: "دورة السيد حسن نصر الله", kind: "tahqiq", kindLabel: "القراءة التحقيقية", teacher: "الأستاذ وسام طالب", place: "حسينية الحكيم، مدينة الصدر", start: "١٣ أيار ٢٠٢٥", status: "open", note: null, graduates: null },
  { name: "دورة فاطمة الزهراء (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ رسول فندي العايدي", place: "حي طارق", start: "١٥ تشرين الثاني ٢٠٢٤", status: "open", note: null, graduates: null },
  { name: "دورة أئمة البقيع (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ أبو غزوان، الأستاذ سلام مجيد", place: "جامع وحسينية الإمام السجاد (ع)، البلديات", start: "٩ حزيران ٢٠٢٤", status: "open", note: null, graduates: null },
  { name: "دورة الإمام الجواد (ع)", kind: "tahqiq", kindLabel: "القراءة التحقيقية", teacher: "الشيخ قاسم الكناني", place: "حسينية أصحاب الكساء (ع)، حي طارق", start: "١ شباط ٢٠٢٣", status: "open", note: null, graduates: null },
  { name: "دورة الحسن المجتبى (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ أحمد الذهبي", place: null, start: "١ كانون الأول ٢٠٢٤", status: "done", note: "تخرّجت في محفل ١٢ أيلول ٢٠٢٥", graduates: "٣" },
  { name: "دورة الإمام المنتظر (عج)", kind: null, kindLabel: null, teacher: "السيد محمد البطاط، الشيخ أبو مصطفى الدراجي", place: null, start: "٢٩ تشرين الأول ٢٠٢٤", status: "done", note: "تخرّجت في محفل ١٢ أيلول ٢٠٢٥", graduates: "٦" },
  { name: "دورة أبي الفضل العباس (ع)", kind: "nagham", kindLabel: "النغم القرآني", teacher: "الأستاذ علاء", place: "جامع أبي الفضل العباس (ع)، البلديات", start: "٣ أيار ٢٠٢٤", status: "done", note: "تخرّجت في محفل ١٢ أيلول ٢٠٢٥", graduates: null },
  { name: "دورة قطيع الكفين (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ وسام طالب البنداوي", place: "مدينة الصدر، الأورفلي", start: "١ أيلول ٢٠٢٣", status: "done", note: "تخرّجت في محفل ١٢ أيلول ٢٠٢٥", graduates: "٣" },
  { name: "دورة باب المراد الإمام الجواد (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الشيخ صلاح الساعدي", place: null, start: "٢٠٢٣", status: "done", note: "تخرّجت في محفل ١٢ أيلول ٢٠٢٥", graduates: null },
  { name: "دورة قطيع الكفين (ع) النغمية الأولى", kind: "nagham", kindLabel: "النغم القرآني", teacher: "الأستاذ حمزة مناتي", place: "جامع وحسينية الإمام السجاد (ع)، البلديات", start: "نيسان ٢٠٢٢", status: "done", note: "تخرّجت في محفل ١٢ أيلول ٢٠٢٥", graduates: null },
  { name: "دورة الصديقة الكبرى (ع)", kind: "tahqiq", kindLabel: "القراءة التحقيقية والإجازة بقراءة عاصم", teacher: "الأستاذ ضياء اللامي", place: null, start: "١٤ آذار ٢٠٢١", status: "done", note: "انتهت ١٦ شباط ٢٠٢٥ · الاختبار ٥ نيسان ٢٠٢٥", graduates: "٥ مجازين" },
  { name: "دورة خاتم المرسلين (ص)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الأستاذ ضياء اللامي", place: null, start: "٢٠٢١", status: "done", note: "انتهت ١٢ شباط ٢٠٢٢", graduates: "٥" },
  { name: "دورة زين العابدين (ع)", kind: "tajweed", kindLabel: "أحكام التلاوة والتجويد", teacher: "الشيخ قاسم الكناني", place: "جامع وحسينية الإمام السجاد (ع)، البلديات", start: "٢٠٢١", status: "unknown", note: null, graduates: null },
  { name: "دورة بقية الله (عج)", kind: "tahqiq", kindLabel: "القراءة التحقيقية", teacher: "الأستاذ ضياء اللامي", place: "حسينية أبي الفضل العباس (ع) ثم جامع الإمام السجاد (ع)", start: null, status: "unknown", note: null, graduates: null },
];

export const TEACHERS: Teacher[] = [
  { name: "قاسم الكناني", title: "الشيخ المقرئ · مدير المدرسة", specialty: "القراءة التحقيقية" },
  { name: "عباس المنشداوي", title: "الشيخ · القارئ والمحكم الدولي", specialty: "النغم القرآني" },
  { name: "ضياء اللامي", title: "الأستاذ المقرئ", specialty: "القراءة التحقيقية والإجازة" },
  { name: "علاء زامل الدراجي", title: "القارئ الأستاذ", specialty: "النغم والتجويد" },
  { name: "حمزة مناتي اللامي", title: "الأستاذ", specialty: "النغم القرآني" },
  { name: "وسام طالب البنداوي", title: "الأستاذ", specialty: "التجويد والقراءة التحقيقية" },
  { name: "صلاح الساعدي", title: "الشيخ", specialty: "أحكام التلاوة والتجويد" },
  { name: "محمد البطاط", title: "السيد", specialty: null },
  { name: "أبو مصطفى الدراجي", title: "الشيخ", specialty: null },
  { name: "يوسف طالب", title: "الأستاذ المقرئ", specialty: null },
  { name: "أبو غزوان", title: "الأستاذ", specialty: "أحكام التلاوة والتجويد" },
  { name: "سلام مجيد", title: "الأستاذ", specialty: "أحكام التلاوة والتجويد" },
  { name: "أحمد حنش الذهبي", title: "الأستاذ · جناح حي طارق", specialty: "أحكام التلاوة والتجويد" },
  { name: "رسول فندي العايدي", title: "الأستاذ · جناح حي طارق", specialty: "أحكام التلاوة والتجويد" },
];

export const OPEN_COURSES = COURSES.filter((c) => c.status === 'open');
export const DONE_COURSES = COURSES.filter((c) => c.status === 'done');
export const MAHFAL_COURSES = DONE_COURSES.filter((c) => c.note?.includes('محفل'));

/** الدورات الست المعروضة في الرئيسية: أحدث ثلاث، ثم واحدة من كل جناح ونوع. */
export const HOME_COURSES = [
  'دورة نغمية بالطريقة العراقية',
  'دورة السيدة نرجس (ع)',
  'دورة سكينة بنت الإمام الحسين (ع)',
  'دورة الرسول الأكرم محمد (ص)',
  'دورة الإمام الجواد (ع)',
  'دورة فاطمة الزهراء (ع)',
].map((n) => COURSES.find((c) => c.name === n)!);

// رقم الهاتف هو رقم المدرسة المنشور في صفحتها، ورقم واتساب هو المربوط بالصفحة للتسجيل (رقمان مختلفان عمداً).
export const CONTACT = {
  phone: '0770 289 7973',
  phoneHref: 'tel:+9647702897973',
  whatsapp: 'https://wa.me/9647729841000',
  facebook: 'https://www.facebook.com/profile.php?id=61586077422709',
  instagram: 'https://www.instagram.com/noor.awsiya',
  youtube: 'https://www.youtube.com/@noor.awsiya',
};

/** سنة أحدث دورة في السجل (بالأرقام العربية)، لوسم «جديد». */
export const LATEST_YEAR = COURSES.map((c) => c.start?.match(/[٠-٩]{4}/)?.[0] ?? '').sort().at(-1) ?? '';

const AR = new Intl.NumberFormat('ar-EG', { useGrouping: false });
export const ar = (n: number) => AR.format(n);

/** «٣ دورات» للأعداد من ٣ إلى ١٠، و«٢٠ دورة» لما فوقها، كما في العربية. */
export function countOf(n: number, plural: string, singular: string) {
  return `${ar(n)} ${n >= 3 && n <= 10 ? plural : singular}`;
}
