// المحرك الاقتصادي والتشغيلي: يحسب الإيرادات والتكاليف والعملاء والجودة يومًا بيوم
// بمعادلات صريحة. الذكاء الاصطناعي لا يكتب هذه الأرقام.
import { clamp } from './effects.js';

export function computeMrr(company) {
  const keyMrr = company.accounts
    .filter((a) => a.status === 'active')
    .reduce((s, a) => s + a.mrr, 0);
  return Math.round(keyMrr + company.tail.count * company.tail.avgMrr);
}

export function customerCount(company) {
  return company.tail.count + company.accounts.filter((a) => a.status === 'active').length;
}

export function monthlyBurn(company) {
  const c = company.costs;
  return c.payrollMonthly + c.infraMonthly + company.marketing.monthlyBudget;
}

/** مستوى الرضا المستهدف الذي تنجذب إليه صحة العملاء بحسب الجودة وتراكم الدعم. */
export function targetHealth(company) {
  const backlogPenalty = Math.min(100, company.supportBacklog * 1.2);
  return clamp(0.65 * company.productQuality + 0.35 * (100 - backlogPenalty), 0, 100);
}

/** معدل الإلغاء الشهري للعملاء الصغار بحسب متوسط رضاهم. */
export function monthlyChurnRate(avgHealth) {
  return 0.01 + Math.max(0, 60 - avgHealth) / 100 * 0.15;
}

/** عدد العملاء الجدد المتوقع شهريًا. */
export function monthlyAcquisition(company) {
  const m = company.model;
  const cheapestRival = Math.min(...company.competitors.map((c) => c.seatPrice));
  const priceFactor = Math.pow(cheapestRival / company.pricing.seatPrice, 1.5);
  const qualityFactor = company.productQuality / 70;
  const brandFactor = 0.5 + company.brand / 100;
  return (company.marketing.monthlyBudget / m.baseCac) * priceFactor * qualityFactor * brandFactor
    + m.organicMonthly * qualityFactor;
}

/** يوم عمل واحد من حياة الشركة. يعيد قائمة أحداث نصية لسجل الشركة. */
export function tickDay(state, rng) {
  const c = state.company;
  const m = c.model;
  const notes = [];

  // 1) المال
  const mrr = computeMrr(c);
  c.cash = Math.round(c.cash + mrr / 30 - monthlyBurn(c) / 30);

  // 2) رضا العملاء الصغار والإلغاء
  const target = targetHealth(c);
  c.tail.avgHealth = clamp(c.tail.avgHealth + (target - c.tail.avgHealth) * 0.05, 0, 100);
  c.tail.churnAcc += (c.tail.count * monthlyChurnRate(c.tail.avgHealth)) / 30;
  let churned = 0;
  while (c.tail.churnAcc >= 1 && c.tail.count > 0) {
    c.tail.count -= 1; c.tail.churnAcc -= 1; churned += 1;
  }

  // 3) الاستحواذ على عملاء جدد
  c.pipelineAcc += monthlyAcquisition(c) / 30;
  let won = 0;
  while (c.pipelineAcc >= 1) {
    c.tail.count += 1; c.pipelineAcc -= 1; won += 1;
  }
  if (won) notes.push({ text: `انضم ${won} عميل جديد.`, tone: 'good' });
  if (churned) notes.push({ text: `ألغى ${churned} عميل صغير اشتراكه.`, tone: 'bad' });

  // 4) الحسابات الكبرى
  for (const a of c.accounts.filter((x) => x.status === 'active')) {
    a.health = clamp(a.health + (target - a.health) * 0.02, 0, 100);
    if (a.health < m.keyAccountRiskHealth) {
      const p = ((m.keyAccountRiskHealth - a.health) / m.keyAccountRiskHealth) * 0.12;
      if (rng.chance(p)) {
        a.status = 'lost';
        notes.push({ text: `خسرت الشركة الحساب الاستراتيجي ${a.name} (${a.mrr.toLocaleString('en')} ريال/شهر).`, tone: 'bad' });
      }
    }
  }

  // 5) الدعم الفني
  const inflow = customerCount(c) / 45 + (100 - c.productQuality) / 25;
  c.supportBacklog = Math.max(0, Math.round((c.supportBacklog + inflow - m.supportCapacityPerDay) * 10) / 10);

  // 6) الفريق
  c.team.morale = clamp(c.team.morale + (70 - c.team.morale) * 0.02, 0, 100);

  // 7) استخدام الخصائص (اتجاهات تستمر حتى يعالجها أحد)
  for (const f of Object.values(c.features)) f.usage = clamp(f.usage + (f.trend ?? 0), 0, 100);

  return notes;
}

export function snapshot(state) {
  const c = state.company;
  return {
    day: state.day,
    cash: c.cash,
    mrr: computeMrr(c),
    customers: customerCount(c),
    keyAccountsActive: c.accounts.filter((a) => a.status === 'active').length,
    productQuality: Math.round(c.productQuality),
    avgHealth: Math.round(c.tail.avgHealth),
    supportBacklog: Math.round(c.supportBacklog),
    morale: Math.round(c.team.morale),
    // null = الشركة رابحة ولا تستهلك نقدها
    runwayMonths: monthlyBurn(c) > computeMrr(c)
      ? Math.round((c.cash / (monthlyBurn(c) - computeMrr(c))) * 10) / 10
      : null,
  };
}
