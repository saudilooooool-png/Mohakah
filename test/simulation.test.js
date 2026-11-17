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

test('الأسبوع الأول متدرج: اليوم الأول تعريفي بلا أزمات، والضغط يبدأ لاحقًا', () => {
  const sim = newSim();
  const day1 = sim.inbox();
  assert.ok(day1.length >= 3 && day1.length <= 5, 'يوم تعريفي ببنود قليلة');
  assert.ok(day1.every((i) => i.priority !== 'critical' && i.priority !== 'high'), 'لا بنود حرجة أو عالية في اليوم الأول');
  assert.ok(day1.some((i) => i.attachments.includes('handbook')), 'دليل الموظف مرفق');
  assert.ok(day1.some((i) => i.eventId === 'd1_mentor_check' && i.dialogue), 'محادثة المشرفة للتأكد من الفهم');
  while (sim.day < 3) sim.endDay();
  assert.ok(sim.inbox().some((i) => i.eventId === 'd1_ufuq_complaint'), 'أول مشكلة عميل في اليوم الثالث');
});

test('نفس البذرة ونفس القرارات = نفس العالم تمامًا (قابلية إعادة الإنتاج)', () => {
  const a = runAll(newSim(11));
  const b = runAll(newSim(11));
  assert.deepEqual(a.history, b.history);
  assert.deepEqual(a.feed, b.feed);
});

test('تجاهل شكوى العميل الاستراتيجي يضر صحة الحساب والثقة', () => {
  const ignored = newSim();
  while (ignored.day < 5) ignored.endDay();
  const handled = newSim();
  while (handled.day < 3) handled.endDay();
  handled.respond('d1_ufuq_complaint', 'call_and_plan', { rationale: 'اتصال مباشر' });
  while (handled.day < 5) handled.endDay();
  const h = (s) => s.state.company.accounts.find((a) => a.id === 'ufuq').health;
  assert.ok(h(handled) > h(ignored) + 20);
  assert.ok(ignored.state.player.trust.cs_lead < handled.state.player.trust.cs_lead);
});

test('القرار يغيّر خارطة الطريق، والإطلاق يغيّر مؤشرات المنتج', () => {
  const sim = newSim();
  while (sim.day < 4) sim.endDay();
  sim.respond('d3_sprint_priority', 'reports_fix', { rationale: 'بيانات الاستخدام' });
  assert.equal(sim.state.company.roadmap.active.id, 'reports_fix');
  const before = sim.state.company.features.reports.usage;
  while (!sim.state.flags.reports_fixed && !sim.finished) sim.endDay();
  assert.ok(sim.state.flags.reports_fixed, 'يجب أن يُطلق الإصلاح خلال الشهر');
  assert.ok(sim.state.company.features.reports.usage > before);
});

test('الوعد غير المنفّذ للعميل يعود ليؤثر بعد أيام', () => {
  const sim = newSim();
  while (sim.day < 3) sim.endDay();
  sim.respond('d1_ufuq_complaint', 'promise_date', { rationale: 'وعد' });
  // لا يُضاف الإصلاح لخارطة الطريق، فيمر الموعد دون تنفيذ
  while (sim.day < 15) sim.endDay();
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

test('الزميل المنفّذ: التكليف الواضح يعود بنتيجة جيدة، والعام يعود ناقصًا، ولا يمكن الإسناد قبل انضمامه', () => {
  const at = (day, seed = 2) => { const s = newSim(seed); while (s.day < day) s.endDay(); return s; };
  const clear = at(8);
  const item = clear.inbox().find((i) => i.eventId === 'd8_interviews');
  assert.ok(item.delegable);
  const r = clear.delegate(item.id, 'يا ريان، رتّب مع ريم 5 مقابلات مع عملاء ألغوا اشتراكهم، والهدف معرفة سبب الإلغاء، وأرسل لي ملخصًا قبل الخميس.');
  assert.equal(r.good, true);
  assert.equal(item.status, 'delegated');
  assert.throws(() => clear.respond(item.id, 'run', {}), 'البند المُسند لا يُرد عليه مرة أخرى');
  while (clear.day <= r.returnDay) clear.endDay();
  assert.equal(item.status, 'done');
  assert.ok(clear.feed.some((f) => f.text.includes('أنهيا 5 مقابلات')));

  const vague = at(8);
  const v = vague.delegate(vague.inbox().find((i) => i.eventId === 'd8_interviews').id, 'شوف موضوع المقابلات لو سمحت');
  assert.equal(v.good, false);
  while (vague.day <= v.returnDay) vague.endDay();
  assert.ok(vague.feed.some((f) => f.text.includes('مقابلتين فقط')));
  const people = (s) => s.report().skills.find((x) => x.id === 'people').score;
  assert.ok(people(clear) > people(vague), 'وضوح التكليف يُحتسب في إدارة الأشخاص');
});
