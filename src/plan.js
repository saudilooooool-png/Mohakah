// خطة المتدرب الشخصية ومؤشر "جاهزيتك لسوق العمل".
// المتدرب عميلنا: يبدأ من هدفه (أي وظيفة يسعى إليها؟)، ونريه طريقًا واضحًا وأين يقف فيه كل يوم.
// المؤشر إرشادي يقيس ما أنجزه وأثبته، وليس وعدًا بوظيفة.

export const GOAL_ROLES = {
  pm: 'مدير منتجات',
  sales: 'مبيعات وتطوير أعمال',
  cs: 'خدمة العملاء ونجاحهم',
  marketing: 'تسويق',
  analyst: 'تحليل أعمال وبيانات',
  undecided: 'لم أحدد بعد',
};
export const GOAL_NEEDS = {
  experience: 'خبرة عملية أكتبها في سيرتي',
  level: 'أن أعرف مستواي ونقاط ضعفي',
  confidence: 'ثقة في الاجتماعات والمواقف الصعبة',
  proof: 'دليل موثّق أقدّمه لأصحاب العمل',
};

const cvFilled = (p = {}) => !!(p.summary && (p.education || p.experience) && p.skills);

/**
 * @param {object} s الحالة: days, lengthDays, finished, points, weakest {label, score}, hasRecord, emailVerified,
 *   profile, sharing, portfolioPublished, realWork (عدد), market (عدد), quizAnswered, goal {role, need}
 */
export function buildPlan(s) {
  const days = Math.min(s.days ?? 0, s.lengthDays ?? 30);
  const len = s.lengthDays ?? 30;
  const item = (id, label, done, href, hint = '') => ({ id, label, done: !!done, href, hint });
  const stages = [
    { id: 'start', title: 'ابدأ', sub: 'تعرّف على الشركة وطريقة العمل', items: [
      item('goal', 'حدّد هدفك', s.goal?.role, '#/plan'),
      item('week1', 'أكمل أسبوع التهيئة (5 أيام عمل)', days >= 5, '#/inbox', `${Math.min(days, 5)} من 5`),
      item('verify', 'أكّد بريدك الإلكتروني', s.emailVerified, '#/account'),
    ] },
    { id: 'prove', title: 'أثبت نفسك', sub: 'شهر عمل كامل بقرارات لها عواقب', items: [
      item('month', `أكمل ${len} يوم عمل`, s.finished, '#/inbox', `${days} من ${len}`),
      item('level', 'حقق 700 نقطة أو أكثر', (s.points ?? 0) >= 700 && days >= 5, '#/report', days >= 1 ? `${s.points ?? 0} نقطة الآن` : ''),
      item('weak', 'ارفع أضعف مهاراتك فوق 50%', s.weakest && s.weakest.score >= 50, '#/report', s.weakest ? `${s.weakest.label}: ${s.weakest.score}%` : ''),
    ] },
    { id: 'document', title: 'وثّق', sub: 'حوّل ما أنجزته إلى دليل يُقدَّم', items: [
      item('record', 'أصدر سجلك الموثّق', s.hasRecord, '#/report', s.finished ? '' : 'بعد إكمال الشهر'),
      item('cv', 'أكمل سيرتك الذاتية في صفحتك', cvFilled(s.profile), '#/profile'),
      item('portfolio', 'انشر ملف أعمالك', s.portfolioPublished, '#/portfolio'),
    ] },
    { id: 'real', title: 'طبّق في الواقع', sub: 'عمل حقيقي لجهة حقيقية', items: [
      item('work', 'أنجز عملًا واقعيًا معتمدًا', (s.realWork ?? 0) > 0, '#/work', days < 10 ? 'تُفتح أغلب الفرص بعد 10 أيام عمل' : ''),
      item('market', 'شارك في بحث سوق معتمد', (s.market ?? 0) > 0, '#/work'),
    ] },
    { id: 'show', title: 'اظهر', sub: 'اجعل أصحاب العمل يرونك', items: [
      item('sharing', 'فعّل مشاركة سجلك مع جهات التوظيف الشريكة', s.sharing, '#/account'),
      item('video', 'اصنع فيديو شهرك وانشره', s.videoMade, '#/video', s.portfolioPublished ? '' : 'بعد نشر ملف الأعمال'),
    ] },
  ];
  // المؤشر: ما أُنجز وأُثبت. الأوزان معلنة ومجموعها 100.
  const W = [
    ['أيام العمل المكتملة', 30, days / len],
    // الأداء يُحتسب بقدر ما قُطع من الشهر: نقاط عالية في أيام قليلة لا تعني جاهزية بعد
    ['مستوى الأداء (النقاط)', 25, Math.min(1, (s.points ?? 0) / 850) * (days / len)],
    ['لا مهارة تحت 50%', 10, s.weakest && days >= 5 ? (s.weakest.score >= 50 ? 1 : s.weakest.score / 50) : 0],
    ['السجل الموثّق', 10, s.hasRecord ? 1 : 0],
    ['السيرة وملف الأعمال', 10, (cvFilled(s.profile) ? 0.5 : 0) + (s.portfolioPublished ? 0.5 : 0)],
    ['عمل واقعي أو بحث سوق معتمد', 10, (s.realWork ?? 0) > 0 || (s.market ?? 0) > 0 ? 1 : 0],
    ['الظهور لأصحاب العمل', 5, s.sharing && s.emailVerified ? 1 : 0],
  ];
  const breakdown = W.map(([label, weight, f]) => ({ label, weight, earned: Math.round(weight * Math.max(0, Math.min(1, f))) }));
  const readiness = breakdown.reduce((x, b) => x + b.earned, 0);
  const flat = stages.flatMap((st) => st.items.map((i) => ({ ...i, stage: st.title })));
  // الخطوة التالية: أول بند غير منجز يمكن فعله الآن
  const blocked = (i) => (i.id === 'record' && !s.finished) || (i.id === 'video' && !s.portfolioPublished) || (i.id === 'level' && !s.finished && days < len) || (i.id === 'weak' && days < 5);
  const next = flat.find((i) => !i.done && !blocked(i)) ?? null;
  const band = readiness >= 85 ? 'جاهز وتُرى' : readiness >= 60 ? 'على الطريق الصحيح' : readiness >= 30 ? 'تبني أساسك' : 'في البداية';
  return { readiness, band, breakdown, stages, next, done: flat.filter((i) => i.done).length, total: flat.length };
}
