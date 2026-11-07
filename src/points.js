// نقاط محاكي: مجموع واضح من 1000 يُشتق من مهارات السجل المهني بأوزان معلنة.
// النقاط لا تُحسب إلا من التقرير، والتقرير لا يُحسب على الخادم إلا بإعادة تشغيل الأفعال.

export const POINT_WEIGHTS = {
  decisions: 20,
  prioritization: 15,
  communication: 15,
  people: 15,
  output: 15,
  time: 10,
  impact: 10,
};

export const BANDS = [
  { min: 850, id: 'distinguished', label: 'متميز' },
  { min: 700, id: 'job_ready', label: 'جاهز لسوق العمل' },
  { min: 550, id: 'promising', label: 'واعد' },
  { min: 0, id: 'developing', label: 'قيد التطوير' },
];

/** شروط التوصية لجهات التوظيف (إلى جانب موافقة المتدرب الصريحة). */
export const RECOMMENDATION_RULES = { minPoints: 700, minSkill: 50 };

export function computePoints(report, { finished = false } = {}) {
  const scored = report.skills.filter((s) => POINT_WEIGHTS[s.id] && s.score !== null);
  const totalWeight = scored.reduce((sum, s) => sum + POINT_WEIGHTS[s.id], 0);
  const points = totalWeight ? Math.round(scored.reduce((sum, s) => sum + s.score * POINT_WEIGHTS[s.id], 0) * 10 / totalWeight) : 0;
  const band = BANDS.find((b) => points >= b.min);
  const weakest = scored.reduce((m, s) => (m === null || s.score < m.score ? s : m), null);
  const recommendable = finished
    && points >= RECOMMENDATION_RULES.minPoints
    && scored.length === Object.keys(POINT_WEIGHTS).length
    && scored.every((s) => s.score >= RECOMMENDATION_RULES.minSkill);
  return {
    points,
    max: 1000,
    band: { id: band.id, label: band.label },
    breakdown: scored.map((s) => ({ id: s.id, label: s.label, score: s.score, weight: POINT_WEIGHTS[s.id], points: Math.round(s.score * POINT_WEIGHTS[s.id] / 10) })),
    weakest: weakest && { id: weakest.id, label: weakest.label, score: weakest.score },
    recommendable,
  };
}
