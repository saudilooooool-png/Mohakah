// ملخص أبحاث السوق المعتمدة لمتدرب: يظهر في السجل الموثّق وملف الأعمال، منفصلًا عن نقاط المحاكاة.
export const matches = (q, value, target) => (q.type === 'number'
  ? Math.abs(Number(value) - Number(target)) <= Math.abs(Number(target)) * (q.tolerancePct / 100) + 1e-9
  : String(value) === String(target));
export const settled = (q) => (q.final ? q.final.value : q.status === 'consensus' ? q.consensus.value : null);
export const pointsFor = (q, a) => { const v = settled(q); return v !== null && matches(q, a.value, v) ? q.points : 0; };

export function marketSummary(store, uid) {
  const M = store.market;
  if (!M) return { answered: 0, confirmed: 0, points: 0, items: [] };
  const mine = Object.values(M.answers ?? {}).filter((a) => a.userId === uid && M.questions[a.questionId]);
  const items = mine.map((a) => ({ title: M.questions[a.questionId].title, points: pointsFor(M.questions[a.questionId], a) })).filter((x) => x.points);
  return { answered: mine.length, confirmed: items.length, points: items.reduce((s, x) => s + x.points, 0), items };
}
