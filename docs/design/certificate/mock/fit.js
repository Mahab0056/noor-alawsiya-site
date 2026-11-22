/* قاعدة ملاءمة الاسم (SPEC.md §5). دالة صافية: تأخذ الاسم ودالة قياس، وتعيد الأسطر وحجم الخط.
   النموذج يقيس بـ canvas؛ البناء يقيس بالخط نفسه (advance width بعد التشكيل). لا تصغير أفقي ولا قصّ ولا «…» أبداً.
   measure(text, size) يعيد العرض بوحدة size نفسها (pt في A4 و px في المربع). */
(function (root) {
  var FIT = {
    a4: { width: 220 * 72 / 25.4, one: [44, 40, 36, 32, 28], two: [30, 27, 24, 21, 18, 16, 14], floor: 10 },
    sq: { width: 940, one: [92, 84, 76, 68, 60], two: [72, 64, 56, 50, 44, 40, 36], floor: 24 },
  };
  var SAFETY = 0.98; // 2% هامش: فرق القياس بين محرّك وآخر

  function clean(name) {
    return String(name).replace(/\s+/g, ' ').trim();
  }

  // كلمات لا ينتهي بها السطر الأول: الاسم المركّب لا يُفصل («عبد | الكريم»، «أبو | الفضل»، «آل | ياسين»).
  var GLUE = ['عبد', 'أبو', 'ابو', 'أبي', 'ابي', 'أبا', 'ابن', 'بن', 'بنت', 'آل', 'ال', 'أم', 'ام', 'ذو', 'ذي'];

  /** أفضل قسمة إلى سطرين: عند الفراغ الذي يجعل أعرض السطرين أضيق ما يمكن، وليس بعد كلمة من GLUE.
      null إن لم يكن في الاسم فراغ. إن كانت كل الفراغات بعد كلمات GLUE تُقبل أي قسمة. */
  function bestSplit(name, measure, size) {
    var best = null, bestAny = null;
    for (var i = 0; i < name.length; i++) {
      if (name[i] !== ' ') continue;
      var a = name.slice(0, i), b = name.slice(i + 1);
      var w = Math.max(measure(a, size), measure(b, size));
      var cand = { lines: [a, b], w: w };
      if (!bestAny || w < bestAny.w) bestAny = cand;
      if (GLUE.indexOf(a.slice(a.lastIndexOf(' ') + 1)) >= 0) continue;
      if (!best || w < best.w) best = cand;
    }
    return best || bestAny;
  }

  function fitName(rawName, format, measure) {
    var cfg = FIT[format];
    var name = clean(rawName);
    var max = cfg.width * SAFETY;
    var i, s;
    for (i = 0; i < cfg.one.length; i++) {
      s = cfg.one[i];
      if (measure(name, s) <= max) return { lines: [name], size: s, step: 'one' };
    }
    for (i = 0; i < cfg.two.length; i++) {
      s = cfg.two[i];
      var sp = bestSplit(name, measure, s);
      if (sp && sp.w <= max) return { lines: sp.lines, size: s, step: 'two' };
    }
    // آخر حل: أعرض من كل الدرجات. حجم محسوب من العرض (سطران إن كان في الاسم فراغ، وإلا سطر واحد)،
    // ولا ينزل تحت floor: عندها لا تُصدر الشهادة آلياً ويُنبَّه المشرف.
    var lastTwo = cfg.two[cfg.two.length - 1];
    var sp2 = bestSplit(name, measure, lastTwo);
    if (sp2) {
      s = Math.floor((lastTwo * max / sp2.w) * 10) / 10;
      return { lines: sp2.lines, size: s, step: s >= cfg.floor ? 'shrink' : 'reject' };
    }
    var lastOne = cfg.one[cfg.one.length - 1];
    s = Math.floor((lastOne * max / measure(name, lastOne)) * 10) / 10;
    return { lines: [name], size: s, step: s >= cfg.floor ? 'shrink' : 'reject' };
  }

  root.CertFit = { FIT: FIT, fitName: fitName, clean: clean };
})(typeof window !== 'undefined' ? window : globalThis);
