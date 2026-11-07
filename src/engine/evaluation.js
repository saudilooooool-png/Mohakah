// التقييم المهني: كل درجة مرتبطة بأدلة (بنود صندوق العمل، القرارات، المخرجات، ومؤشرات الشركة).
// لا توجد درجة يصدرها نموذج لغوي دون دليل محفوظ يمكن الرجوع إليه.
import { snapshot } from './economy.js';

const pct = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function buildReport(sim, runBaseline) {
  const acts = sim.actions;
  const handled = acts.filter((a) => a.kind !== 'expired');
  const important = acts.filter((a) => a.priority === 'critical' || a.priority === 'high');

  // إدارة الوقت: نسبة البنود المنجزة في موعدها من كل البنود التي استحقت
  const timeMgmt = acts.length ? acts.filter((a) => a.onTime && a.kind !== 'expired').length / acts.length : null;

  // ترتيب الأولويات: معالجة المهم والعاجل أولًا، وعدم ترك البنود الحرجة تنتهي
  const inversions = handled.filter((a) => a.higherPriorityOpen > 0).length;
  const importantMissed = important.filter((a) => a.kind === 'expired').length;
  const prioritization = acts.length
    ? 0.5 * (handled.length ? 1 - inversions / handled.length : 0)
      + 0.5 * (important.length ? 1 - importantMissed / important.length : 1)
    : null;

  // جودة القرار: جودة الخيار وفق معيار مصمم من خبراء المجال + وجود تبرير
  const decisions = handled.filter((a) => a.kind === 'decision' && a.quality !== null);
  // البنود القرارية التي تُركت حتى انتهت تُحسب صفرًا: عدم اتخاذ القرار قرار أيضًا
  const isDecisionItem = (a) => !sim.items.find((i) => i.id === a.itemId)?.deliverable;
  const missedDecisions = acts.filter((a) => a.kind === 'expired' && isDecisionItem(a));
  const decisionQuality = avg([
    ...decisions.map((d) => 0.85 * d.quality + 0.15 * (d.rationale.trim() ? 1 : 0)),
    ...missedDecisions.map(() => 0),
  ]);

  // التواصل: جودة التبرير في التعامل مع أصحاب المصلحة (مؤشر أولي في الـMVP)
  const comms = handled.filter((a) => a.kind === 'decision' && ['message', 'meeting', 'complaint'].includes(a.category));
  const missedComms = missedDecisions.filter((a) => ['message', 'meeting', 'complaint'].includes(a.category));
  const communication = avg([
    // في الاجتماع الحواري: نسبة الاعتراضات التي أجابها المتدرب فعلًا (دليل أقوى من طول التبرير)
    ...comms.map((d) => (d.addressed
      ? d.addressed.length / Math.max(1, d.concernsTotal)
      : Math.min(1, d.rationale.trim().split(/\s+/).filter(Boolean).length / 20))),
    ...missedComms.map(() => 0),
  ]);

  // جودة المخرجات: درجات المستندات المسلّمة، والمستندات غير المسلّمة تُحسب صفرًا
  const delivs = acts.filter((a) => a.kind === 'deliverable' || (a.kind === 'expired' && sim.items.find((i) => i.id === a.itemId)?.deliverable));
  const outputQuality = avg(delivs.map((d) => (d.kind === 'deliverable' ? d.evaluation.score : 0)));

  // الأثر على الشركة: مقارنة بعالم موازٍ بنفس البذرة لم يتخذ فيه أحد أي قرار
  const baseline = runBaseline();
  const mine = snapshot(sim.state);
  const base = snapshot(baseline.state);
  const mrrDelta = (mine.mrr - base.mrr) / base.mrr;
  const healthDelta = (mine.avgHealth - base.avgHealth) / 100;
  const impact = 0.5 + mrrDelta * 4 + healthDelta * 1.5;

  const skills = [
    { id: 'prioritization', label: 'ترتيب الأولويات', score: prioritization },
    { id: 'decisions', label: 'اتخاذ القرارات', score: decisionQuality },
    { id: 'communication', label: 'التواصل', score: communication },
    { id: 'time', label: 'إدارة الوقت', score: timeMgmt },
    { id: 'output', label: 'جودة المخرجات', score: outputQuality },
    { id: 'impact', label: 'الأثر على نتائج الشركة', score: impact },
  ].map((s) => ({ ...s, score: s.score === null ? null : pct(s.score) }));

  const scored = skills.filter((s) => s.score !== null);
  const overall = Math.round(avg(scored.map((s) => s.score)) ?? 0);
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  return {
    role: sim.scenario.role,
    company: sim.companyData.name,
    daysWorked: sim.history.length - 1,
    overall,
    skills,
    strengths: sorted.slice(0, 2).map((s) => s.label),
    toImprove: sorted.slice(-2).reverse().map((s) => s.label),
    evidence: {
      itemsHandled: handled.length,
      itemsMissed: acts.length - handled.length,
      decisions: decisions.map((d) => ({ day: d.day, event: d.eventId, option: d.optionId, rationale: d.rationale })),
      deliverables: delivs.map((d) => ({ day: d.day, event: d.eventId, score: d.kind === 'deliverable' ? d.evaluation.score : 0, missing: d.kind === 'deliverable' ? d.evaluation.feedback : ['لم يُسلَّم'] })),
      shipped: sim.state.company.roadmap.shipped.map((x) => ({ title: x.title, day: x.shippedDay })),
    },
    companyOutcome: { you: mine, baselineNoActions: base },
    recommendation: recommend(overall, sorted),
  };
}

function recommend(overall, sorted) {
  const weakest = sorted[sorted.length - 1]?.label;
  if (overall >= 80) return `جاهز للانتقال إلى المستوى المتوسط، مع الاستمرار في تطوير: ${weakest}.`;
  if (overall >= 60) return `أداء واعد. أعد التجربة بالتركيز على: ${weakest}، قبل الانتقال إلى مستوى أعلى.`;
  return `ابدأ بأساسيات الدور. أكبر فجوة حالية: ${weakest}.`;
}
