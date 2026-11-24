-- 0008: عدّاد صفحة التسجيل. عدد يومي فقط، بلا أي شيء عن الزائر.
--
-- * day: التاريخ بتوقيت بغداد (يحسبه lib/funnel.ts، لا now() هنا، حتى يتفق الاختبار والخادم).
-- * step: view فتح النموذج، start بدأ الكتابة، review وصل إلى المراجعة، sent ضغط «إرسال الطلب» وقُبل من حدّ
--   الطلبات، saved حُفظ الطلب (يُعدّ داخل معاملة التسجيل نفسها، فإذا رجعت المعاملة رجع العدّ معها).
-- * source: اسم الرابط من ?from= إن كان في campaign_links، وإلا other، وبلا ?from= يكون direct.
--   الشكل نفسه الذي في 0009_campaign_links، فلا يدخل الجدول نص طويل أو غريب.
-- * n: العدد. لا IP ولا جهاز ولا كوكي ولا وقت أدق من اليوم.
--
-- Numbered 0008 (held for the funnel counts since 20/11). The runner applies any file not yet recorded, in name order,
-- so a database that is already at 0013 simply gets this one next. Behind FUNNEL_COUNTS (off): the table stays empty.

create table funnel_daily (
  day date not null,
  step text not null constraint funnel_step check (step in ('view', 'start', 'review', 'sent', 'saved')),
  source text not null
    constraint funnel_source_shape check (char_length(source) between 2 and 20 and source ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  n integer not null default 0 constraint funnel_n_positive check (n >= 0),
  primary key (day, step, source)
);
