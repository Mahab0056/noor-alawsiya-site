import type { RegistrationStatus } from './registration';

export const STATUS_LABEL: Record<RegistrationStatus, string> = { pending: 'قيد المراجعة', accepted: 'مقبول', rejected: 'مرفوض' };
export const STATUS_TAG: Record<RegistrationStatus, string> = { pending: 'warn', accepted: 'ok', rejected: 'bad' };

const DATE = new Intl.DateTimeFormat('ar-IQ-u-nu-arab-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Baghdad' });
export const formatDate = (d: Date) => DATE.format(d);
const DATE_TIME = new Intl.DateTimeFormat('ar-IQ-u-nu-arab-ca-gregory', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Baghdad' });
export const formatDateTime = (d: Date) => DATE_TIME.format(d);

const DIGITS = new Intl.NumberFormat('ar-EG', { useGrouping: false });
/** Arabic-Indic digits, as the site shows numbers everywhere else. Also used in e-mails, where the text has no site font. */
export const arDigits = (n: number) => DIGITS.format(n);
/** «٣ دقائق» / «١١ دقيقة» / «دقيقة واحدة» / «دقيقتان»: the counted noun agrees with the number. `one`/`two` are the whole phrases; `few` (3-10) and `many` (11+) are the noun. */
const counted = (n: number, one: string, two: string, few: string, many: string) => (n === 1 ? one : n === 2 ? two : `${arDigits(n)} ${n >= 3 && n <= 10 ? few : many}`);
export const minutesText = (n: number) => counted(n, 'دقيقة واحدة', 'دقيقتين', 'دقائق', 'دقيقة');
export const hoursText = (n: number) => counted(n, 'ساعة واحدة', 'ساعتين', 'ساعات', 'ساعة');
export const daysText = (n: number) => counted(n, 'يوم واحد', 'يومين', 'أيام', 'يوماً');
export const triesLeftText = (n: number) => (n <= 0 ? 'لم تبقَ محاولات' : n === 1 ? 'بقيت محاولة واحدة' : n === 2 ? 'بقيت محاولتان' : `بقيت ${arDigits(n)} ${n <= 10 ? 'محاولات' : 'محاولة'}`);
