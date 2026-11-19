import type { RegistrationStatus } from './registration';

export const STATUS_LABEL: Record<RegistrationStatus, string> = { pending: 'قيد المراجعة', accepted: 'مقبول', rejected: 'مرفوض' };
export const STATUS_TAG: Record<RegistrationStatus, string> = { pending: 'warn', accepted: 'ok', rejected: 'bad' };

const DATE = new Intl.DateTimeFormat('ar-IQ-u-nu-arab-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Baghdad' });
export const formatDate = (d: Date) => DATE.format(d);
