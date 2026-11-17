// ملخص الأعمال الواقعية المعتمدة لمتدرب: يظهر في التقرير وملف الأعمال والسجل الموثّق، منفصلًا عن نقاط المحاكاة.
export function realWorkSummary(store, uid) {
  const W = store.work;
  if (!W) return { count: 0, points: 0, items: [] };
  const items = Object.values(W.apps ?? {}).filter((a) => a.userId === uid && a.status === 'approved').map((a) => {
    const g = W.gigs[a.gigId];
    return { title: g.title, org: g.org, kind: g.kind, rating: a.rating, points: Math.round((g.points ?? 0) * (a.rating ?? 0) / 5), at: a.updatedAt };
  });
  return { count: items.length, points: items.reduce((s, x) => s + x.points, 0), items };
}
