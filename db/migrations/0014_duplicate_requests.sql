-- 0014: «يمكن مكرر» في طلبات التسجيل (awsiya-dev-duplicate-requests-2221، خلف المفتاح DUPLICATE_HINTS).
--
-- * الحالة 'duplicate': الأدمن أغلق الطلب لأنه نسخة من طلب آخر («اعتبره مكرر»). ليست رفضاً: لا تُعدّ في المرفوضة،
--   ولا تُجهَّز لها رسالة واتساب. لا تفتح الدروس (enrollments يقرأ 'accepted' فقط)، ولا تمنع طلباً جديداً
--   (registrations_one_live_idx على 'pending' و'accepted' فقط).
-- * duplicate_of: رقم الطلب الآخر. يُكتب عند الإغلاق، أو عند وصول طلب من الاستمارة العامة لرقم هاتف عليه طلب
--   ينتظر للدورة نفسها (يبقى الطلب الجديد 'pending' ومحفوظاً، والأدمن يقرر). مرجع رقمي فقط: لا بيانات شخصية جديدة.
--
-- رقم 0014: 0001-0007 و0009 و0012 و0013 على هذا الخط، 0008 محجوز لـ funnel-counts، 0010 للانتظار (PR #3)، 0011 للتقدّم.
-- ADD VALUE داخل معاملة مسموح منذ Postgres 12 ما دامت القيمة لا تُستعمل في المعاملة نفسها، وهذا الملف لا يستعملها.

alter type registration_status add value if not exists 'duplicate';

alter table registrations add column duplicate_of bigint references registrations(id) on delete set null;
alter table registrations add constraint registrations_not_own_duplicate check (duplicate_of is null or duplicate_of <> id);
