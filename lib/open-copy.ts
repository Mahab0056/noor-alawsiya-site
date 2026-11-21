/**
 * What the header strip and the home page say about registration. It must match /register, which only takes requests
 * for courses a super admin opened in /admin/courses. Before this, both always said «التسجيل مفتوح» while /register said
 * «التسجيل غير متاح الآن» (the live site on 21/11/2026). Pure, so it can be tested without a database.
 *
 * openCount: courses open for registration now; null while unknown (streaming, or the database did not answer).
 */
export type RegistrationCopy = { strip: string; title: string; text: string };

export function registrationCopy(openCount: number | null): RegistrationCopy {
  if (openCount === null) {
    return { strip: '', title: 'التسجيل في دورات المدرسة', text: 'سجّل من الموقع حين تُفتح دورة وتابع طلبك من حسابك، أو راسل المدرسة على واتساب.' };
  }
  if (openCount > 0) {
    return { strip: 'التسجيل مفتوح للدورات الحالية', title: 'التسجيل مفتوح في الدورات القائمة', text: 'سجّل من الموقع وتابع طلبك من حسابك، أو راسل المدرسة على واتساب.' };
  }
  return { strip: 'التسجيل من الموقع مغلق حالياً', title: 'التسجيل من الموقع مغلق حالياً', text: 'لا توجد دورة مفتوحة للتسجيل الآن. راسل المدرسة على واتساب لتعرف موعد الدورات القادمة.' };
}
