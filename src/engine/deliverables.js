// تقييم المخرجات المكتوبة.
// نسخة الـMVP: معيار شفاف قائم على الأقسام المطلوبة والكلمات الدالة والحد الأدنى للطول.
// لاحقًا: مقيّم ذكاء اصطناعي يعمل على نفس المعيار (rubric) ويعيد درجة لكل قسم مع اقتباس الدليل،
// وتخضع عينة من تقييماته لمراجعة بشرية. المعيار نفسه يبقى هو المرجع، لا رأي النموذج.

const normalize = (s) => s
  .toLowerCase()
  .replace(/[إأآا]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[ً-ْ]/g, '');

export function scoreDeliverable(spec, text = '') {
  const body = normalize(text);
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sections = spec.sections.map((sec) => {
    const hits = sec.keywords.filter((k) => body.includes(normalize(k)));
    const covered = hits.length >= (sec.minHits ?? 1);
    return { id: sec.id, label: sec.label, covered, evidence: hits };
  });
  const coverage = sections.filter((s) => s.covered).length / sections.length;
  const lengthFactor = Math.min(1, words / (spec.minWords ?? 80));
  const score = Math.round((0.8 * coverage + 0.2 * lengthFactor) * 100) / 100;
  return {
    score,
    words,
    sections,
    feedback: sections.filter((s) => !s.covered).map((s) => `ينقص المستند: ${s.label}`),
  };
}
