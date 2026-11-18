// حزمة الدور: الوصف الوظيفي، وأهداف فترة التجربة، ومصفوفة الصلاحيات، وإجراءات العمل، وتقييم الأداء.
// كل ما هنا دوال نقية تُحسب من المحاكاة نفسها (على الخادم بإعادة التشغيل)، بلغة تفهمها الموارد البشرية.

export const PACK_BY_SCENARIO = { 'pm-first-30-days': 'pm', 'sales-month': 'sales', 'cs-month': 'cs' };
export const packOf = (roles, scenarioId) => roles?.[PACK_BY_SCENARIO[scenarioId]] ?? null;

const RATING = [[85, 5, 'يتجاوز التوقعات'], [70, 4, 'يحقق التوقعات بثبات'], [55, 3, 'يحقق التوقعات'], [40, 2, 'يحتاج تطويرًا'], [0, 1, 'دون المطلوب']];
export const ratingOf = (score) => { const r = RATING.find(([min]) => score >= min); return { rating: r[1], label: r[2] }; };

const DEVELOP = {
  prioritization: 'ابدأ يومك بسؤال: أي بند خسارته أكبر إن تأخر؟ وأجّل الباقي صراحة.',
  decisions: 'قبل كل قرار اكتب: ما الدليل، وما البديل، وما المخاطرة. واسأل صاحب الأرقام.',
  communication: 'أجب عن كل اعتراض برقم أو موعد، وأغلق الحلقة برد واضح بعد كل مهمة.',
  time: 'اطلب ما يأخذ وقتًا مبكرًا، وبلّغ فور علمك بأي تأخير.',
  output: 'ابدأ المستند بالخلاصة والتوصية، واجعل كل هدف رقمًا وموعدًا.',
  people: 'فوّض بهدف ومطلوب وموعد، واحجز جلسات تعارف قبل أن تحتاج أصحابها.',
  impact: 'تابع التقرير الصباحي: أي مؤشر تحرك بعد قرارك؟ وعدّل مبكرًا.',
};

/** التجاوزات: خيارات خالفت مصفوفة الصلاحيات أو إجراءات العمل. */
export function compliance(pack, sim) {
  const rules = pack?.compliance ?? [];
  return sim.actions.filter((a) => a.kind === 'decision').flatMap((a) => {
    const r = rules.find((x) => x.event === a.eventId && x.option === a.optionId);
    return r ? [{ day: a.day, event: a.eventId, kind: r.kind, rule: r.rule }] : [];
  });
}

function measure(m, sim, report, violations) {
  const acc = (id) => sim.state.company.accounts.find((a) => a.id === id);
  switch (m.type) {
    case 'account': { const a = acc(m.id); const v = a && a.status === 'active' ? Math.round(a.health) : 0; return { ok: v >= m.min, actual: a?.status === 'active' ? `${v}` : 'ألغى العميل' }; }
    case 'flag': return { ok: !!sim.state.flags[m.name], actual: sim.state.flags[m.name] ? 'تم' : 'لم يتم بعد' };
    case 'skill': { const s = report.skills.find((x) => x.id === m.skill)?.score; return { ok: s !== null && s !== undefined && s >= m.min, actual: s === null || s === undefined ? '—' : `${s}%` }; }
    case 'missed': return { ok: report.evidence.itemsMissed <= m.max, actual: `${report.evidence.itemsMissed}` };
    case 'trust': { const v = Math.round(sim.state.player.trust[m.who] ?? 0); return { ok: v >= m.min, actual: `${v}` }; }
    case 'compliance': return { ok: violations.length <= m.max, actual: `${violations.length}` };
    case 'network': return { ok: report.evidence.network.internal >= m.internal, actual: `${report.evidence.network.internal}` };
    default: return { ok: false, actual: '—' };
  }
}

/**
 * تقييم الأداء في فترة التجربة. يعيد: الأهداف وما تحقق منها، وتقدير كل جدارة، والتجاوزات، وخطة التطوير، وقرار التثبيت.
 * @param {object} pack حزمة الدور
 * @param {Simulation} sim
 * @param {{points:number}} pts نتيجة computePoints
 */
export function appraise(pack, sim, pts) {
  if (!pack) return null;
  const report = sim.report();
  const violations = compliance(pack, sim);
  const objectives = pack.objectives.map((o) => ({ id: o.id, label: o.label, ...measure(o.measure, sim, report, violations) }));
  const achieved = objectives.filter((o) => o.ok).length;
  const competencies = pack.competencies.map((c) => {
    const s = report.skills.find((x) => x.id === c.id)?.score;
    return { id: c.id, label: c.label, score: s ?? null, ...(s === null || s === undefined ? { rating: null, ratingLabel: 'لم تُقَس بعد' } : (({ rating, label }) => ({ rating, ratingLabel: label }))(ratingOf(s))) };
  });
  const rated = competencies.filter((c) => c.rating !== null).sort((a, b) => a.score - b.score);
  const weakest = rated[0];
  // قرار التثبيت: ثلاث نتائج، كلها بطريق واضح إلى الأمام
  let decision = { id: 'in_progress', label: 'قيد التجربة', text: `أكمل ${sim.lastDay} يوم عمل ليصدر قرار التثبيت.` };
  if (sim.finished) {
    const reasons = [];
    if (achieved < 4) reasons.push(`تحقق ${achieved} من ${objectives.length} أهداف (المطلوب 4)`);
    if (pts.points < 700) reasons.push(`النقاط ${pts.points} (المطلوب 700)`);
    if (weakest && weakest.score < 50) reasons.push(`${weakest.label} دون 50%`);
    if (!reasons.length) decision = { id: 'confirmed', label: 'يُثبَّت في الوظيفة', text: 'اجتاز فترة التجربة: حقق أهدافها، وأداؤه يحقق توقعات الدور.' };
    else if (achieved >= 2 || pts.points >= 550) decision = { id: 'extended', label: 'تُمدَّد فترة التجربة مع خطة تطوير', text: `أداء واعد يحتاج استكمالًا: ${reasons.join('، ')}.`, reasons };
    else decision = { id: 'repeat', label: 'تُعاد فترة التجربة', text: `لم تتحقق متطلبات التثبيت: ${reasons.join('، ')}.`, reasons };
  }
  return {
    role: { id: pack.id, title: pack.title, dept: pack.dept, grade: pack.grade },
    days: report.daysWorked, lengthDays: sim.lastDay, finished: sim.finished, points: pts.points,
    objectives, achieved, total: objectives.length,
    competencies, violations,
    strengths: report.strengths, development: rated.slice(0, 2).map((c) => ({ competency: c.label, action: DEVELOP[c.id] })),
    decision,
  };
}
