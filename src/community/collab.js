// دليل "التعاون ودعم الزملاء": لعب أدوار في جلسات الآخرين ومراجعة مستنداتهم.
// منفصل تمامًا عن النقاط الرسمية، ويظهر في التقرير والسجل الموثّق كما هو.

export function ensurePeer(C) {
  C.peer ??= {};
  C.peer.assignments ??= {};
  C.peer.reviews ??= {};
  return C.peer;
}

export function collaborationSummary(C, userId) {
  const roles = Object.values(C.sessions ?? {}).filter((s) => s.status === 'closed' && Object.values(s.roles ?? {}).includes(userId));
  const ratings = roles.map((s) => s.ratings?.[userId]).filter(Boolean);
  const given = Object.values(ensurePeer(C).reviews).filter((r) => r.reviewerId === userId && !r.hidden);
  return {
    rolesPlayed: roles.length,
    avgRoleRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    reviewsGiven: given.length,
    reviewsHelpful: given.filter((r) => r.helpful === true).length,
  };
}

/** حق الحذف: يزيل مراجعات المستخدم وتكليفاته، ويحذف بياناته من الجلسات الحية. */
export function forgetUser(C, userId) {
  const P = ensurePeer(C);
  for (const [k, a] of Object.entries(P.assignments)) if (a.reviewerId === userId || a.authorId === userId) delete P.assignments[k];
  for (const [k, r] of Object.entries(P.reviews)) if (r.reviewerId === userId || r.authorId === userId) delete P.reviews[k];
  delete C.reviews?.[userId];
  delete C.liveResults?.[userId];
}
