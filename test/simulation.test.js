import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, loadCompany, loadScenario, scoreDeliverable, economy } from '../src/index.js';

const company = loadCompany('nova-tech');
const scenario = loadScenario('pm-first-30-days');
const newSim = (seed = 3) => new Simulation({ company, scenario, seed });

function runAll(sim, play = () => {}) {
  while (!sim.finished) { play(sim); sim.endDay(); }
  return sim;
}

test('اليوم الأول يبدأ بصندوق عمل مرتب حسب الأولوية', () => {
  const sim = newSim();
  const inbox = sim.inbox();
  assert.ok(inbox.length >= 6, 'يجب أن تكون هناك ستة بنود على الأقل في اليوم الأول');
  assert.equal(inbox[0].priority, 'critical');
  assert.equal(inbox[0].eventId, 'd1_ufuq_complaint');
});

test('نفس البذرة ونفس القرارات = نفس العالم تمامًا (قابلية إعادة الإنتاج)', () => {
  const a = runAll(newSim(11));
  const b = runAll(newSim(11));
  assert.deepEqual(a.history, b.history);
  assert.deepEqual(a.feed, b.feed);
});

test('تجاهل شكوى العميل الاستراتيجي يضر صحة الحساب والثقة', () => {
  const ignored = newSim();
  ignored.endDay(); ignored.endDay();
  const handled = newSim();
  handled.respond('d1_ufuq_complaint', 'call_and_plan', { rationale: 'اتصال مباشر' });
  handled.endDay(); handled.endDay();
  const h = (s) => s.state.company.accounts.find((a) => a.id === 'ufuq').health;
  assert.ok(h(handled) > h(ignored) + 20);
  assert.ok(ignored.state.player.trust.cs_lead < handled.state.player.trust.cs_lead);
});

test('القرار يغيّر خارطة الطريق، والإطلاق يغيّر مؤشرات المنتج', () => {
  const sim = newSim();
  sim.endDay(); sim.endDay();
  sim.respond('d3_sprint_priority', 'reports_fix', { rationale: 'بيانات الاستخدام' });
  assert.equal(sim.state.company.roadmap.active.id, 'reports_fix');
  const before = sim.state.company.features.reports.usage;
  while (!sim.state.flags.reports_fixed && !sim.finished) sim.endDay();
  assert.ok(sim.state.flags.reports_fixed, 'يجب أن يُطلق الإصلاح خلال الشهر');
  assert.ok(sim.state.company.features.reports.usage > before);
});

test('الوعد غير المنفّذ للعميل يعود ليؤثر بعد أيام', () => {
  const sim = newSim();
  sim.respond('d1_ufuq_complaint', 'promise_date', { rationale: 'وعد' });
  // لا يُضاف الإصلاح لخارطة الطريق، فيمر الموعد دون تنفيذ
  while (sim.day < 12) sim.endDay();
  assert.ok(sim.feed.some((f) => f.text.includes('مرّ موعد الإصلاح')));
});

test('تقييم المستندات يعتمد على أقسام وأدلة صريحة', () => {
  const spec = scenario.events.find((e) => e.id === 'd1_usage_report').deliverable;
  const weak = scoreDeliverable(spec, 'سأنظر في الأمر.');
  const strong = scoreDeliverable(spec,
    'المشكلة انخفاض الاستخدام من 58% إلى 41%. البيانات بالمقارنة تظهر أن السبب بطء التقارير. التوصية: نقترح إصلاح الأداء. مؤشر النجاح: قياس نسبة الاستخدام.');
  assert.ok(weak.score < 0.3);
  assert.ok(strong.score > 0.75);
  assert.ok(weak.feedback.length > 0);
});

test('المتدرب الفاعل يتفوق على المتدرب السلبي في التقييم ونتائج الشركة', () => {
  const passive = runAll(newSim(5));
  const active = runAll(newSim(5), (sim) => {
    for (const item of sim.inbox()) {
      if (item.deliverable) continue;
      const best = [...item.options].sort((a, b) => b.quality - a.quality)[0];
      sim.respond(item.id, best.id, { rationale: 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات في هذه المرحلة' });
    }
  });
  const ra = active.report();
  const rp = passive.report();
  assert.ok(ra.overall > rp.overall + 30, `${ra.overall} vs ${rp.overall}`);
  assert.ok(economy.computeMrr(active.state.company) > economy.computeMrr(passive.state.company));
  assert.equal(rp.skills.find((s) => s.id === 'impact').score, 50, 'السلبي يطابق خط الأساس');
});

test('المحرك الاقتصادي: المال يتغير وفق الإيرادات والتكاليف فقط', () => {
  const sim = newSim();
  const c = sim.state.company;
  const expected = Math.round(c.cash + economy.computeMrr(c) / 30 - economy.monthlyBurn(c) / 30);
  sim.endDay();
  assert.equal(c.cash, expected);
});

test('لا يمكن الرد بخيار غير مسموح أو على بند مغلق', () => {
  const sim = newSim();
  assert.throws(() => sim.respond('d1_welcome', 'nope'));
  sim.respond('d1_welcome', 'reply_thanks');
  assert.throws(() => sim.respond(sim.items.find((i) => i.eventId === 'd1_welcome').id, 'reply_thanks'));
});

test('كل الآثار والأحداث في السيناريو صالحة', () => {
  // تشغيل كل الخيارات لكل حدث في عوالم منفصلة للتأكد من عدم وجود آثار غير معروفة
  for (const ev of scenario.events.filter((e) => e.options?.length)) {
    for (const opt of ev.options) {
      const sim = newSim();
      while (sim.day < ev.day) sim.endDay();
      const item = sim.inbox().find((i) => i.eventId === ev.id);
      if (!item) continue; // حدث مشروط لم تتحقق شروطه
      sim.respond(item.id, opt.id, { rationale: 'اختبار' });
      while (!sim.finished) sim.endDay();
    }
  }
});
