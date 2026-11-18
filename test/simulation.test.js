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
      if (item.deliverable || item.research) continue;
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

test('ساعات يوم العمل: 8 ساعات تستهلكها المهام، ومن تنتهي ساعاته ينتظر الغد', () => {
  const sim = newSim();
  assert.equal(sim.hoursLeft, 8);
  const meeting = sim.inbox().find((i) => i.eventId === 'd1_kickoff');
  sim.respond(meeting.id, 'listen_ask', {});
  assert.equal(sim.hoursLeft, 7, 'الاجتماع ساعة');
  for (let i = 0; i < 7; i++) sim.wait();
  assert.equal(sim.hoursLeft, 0);
  assert.throws(() => sim.respond('d1_welcome', 'reply_thanks', {}), /انتهت ساعات/);
  sim.endDay();
  assert.equal(sim.hoursLeft, 8, 'يوم جديد');
});

test('مهمة البحث: مصادر متضاربة، وطلب تحليل يأخذ وقتًا، وحد يومي، والجواب الصحيح يحتاج دليلًا', () => {
  const at = () => { const s = newSim(6); while (s.day < 9) s.endDay(); return s; };
  const sim = at();
  const item = sim.inbox().find((i) => i.eventId === 'd9_research_lost');
  assert.ok(item.research);
  // مصدر لا يعرف: تلميح لا معلومة
  assert.equal(sim.investigate(item.id, 'cfo').data, false);
  assert.throws(() => sim.investigate(item.id, 'cfo'), /سبق/);
  assert.equal(sim.investigate(item.id, 'crm').data, true);
  // طلب تحليل: يجهز بعد 3 ساعات عمل
  const before = sim.hoursUsed;
  assert.deepEqual(sim.investigate(item.id, 'analyst'), { pending: true, delay: 3 });
  assert.equal(sim.hoursUsed, before + 0.25);
  assert.equal(item.pending.length, 1);
  sim.wait(); sim.wait();
  assert.equal(item.pending.length, 1, 'لم يجهز بعد');
  sim.wait();
  assert.equal(item.pending.length, 0);
  assert.ok(item.findings.at(-1).text.includes('26 ساعة'));
  const r = sim.submitResearch(item.id, { reason: 'تأخر الرد والمتابعة', count: 4 });
  assert.deepEqual([r.good, r.quality], [true, 1]);
  assert.ok(sim.feed.some((f) => f.text.includes('المتابعة لا في السعر')));

  // من صدّق أول رأي سمعه
  const lazy = at();
  const it2 = lazy.inbox().find((i) => i.eventId === 'd9_research_lost');
  lazy.investigate(it2.id, 'sales_head');
  assert.equal(lazy.submitResearch(it2.id, { reason: 'السعر', count: 3 }).good, false);
  // تخمين صحيح دون أي بحث لا يُحتسب كاملًا
  const guess = at();
  const it3 = guess.inbox().find((i) => i.eventId === 'd9_research_lost');
  assert.equal(guess.submitResearch(it3.id, { reason: 'تأخر الرد والمتابعة', count: 4 }).quality, 0.3);
});

test('طلب التحليل الذي لا يكتمل اليوم يجهز صباح الغد، وطلبات التحليل محدودة في اليوم', () => {
  const sim = newSim(6); while (sim.day < 14) sim.endDay();
  const item = sim.inbox().find((i) => i.eventId === 'd14_research_cac');
  for (let i = 0; i < 7; i++) sim.wait();
  sim.investigate(item.id, 'finance_sheet'); // 0.25 ساعة، ويحتاج ساعتين: لن يجهز اليوم
  assert.equal(item.pending.length, 1);
  sim.endDay();
  assert.equal(item.pending.length, 1, 'بقي له وقت');
  sim.wait(); sim.wait();
  assert.equal(item.pending.length, 0, 'جهز في اليوم التالي');
});

test('بناء العلاقات: جلسة التعارف تبني الثقة مرة كل خمسة أيام، ومع العميل ترفع رضاه، وتُسجَّل دليلًا', () => {
  const sim = newSim(4);
  const t0 = sim.state.player.trust.eng_lead;
  const r = sim.connect('eng_lead');
  assert.deepEqual([r.first, r.gain], [true, 3]);
  assert.equal(sim.state.player.trust.eng_lead, t0 + 3);
  assert.equal(sim.hoursLeft, 7.5);
  assert.throws(() => sim.connect('eng_lead'), /قبل أيام/);
  const h0 = sim.state.company.accounts.find((a) => a.id === 'masar').health;
  sim.connect('masar_contact');
  assert.equal(sim.state.company.accounts.find((a) => a.id === 'masar').health, h0 + 3);
  for (let i = 0; i < 5; i++) sim.endDay();
  assert.equal(sim.connect('eng_lead').gain, 1, 'الأثر الأكبر في المرة الأولى');
  const n = sim.report().evidence.network;
  assert.deepEqual([n.sessions, n.internal, n.external], [3, 1, 1]);
});

test('شهر المبيعات وشهر نجاح العملاء: تهيئة، ثم إدارتك، ثم تدوير في إدارتين، ثم عودة', async () => {
  const { loadScenario } = await import('../src/index.js');
  const { validateDialogueSpec } = await import('../src/agents/meeting.js');
  for (const [id, home, r1] of [['sales-month', 'sales', 'cs'], ['cs-month', 'cs', 'sales']]) {
    const sc = loadScenario(id);
    assert.equal(sc.lengthDays, 30);
    for (const e of [...sc.events, ...sc.randomEvents].filter((x) => x.dialogue)) assert.deepEqual(validateDialogueSpec(e, company.people), [], `${id}/${e.id}`);
    const sim = new Simulation({ company, scenario: sc, seed: 5 });
    assert.equal(sim.rotationNow().dept, home);
    assert.ok(sim.inbox().some((i) => i.attachments.includes('handbook')), 'تهيئة في اليوم الأول');
    while (sim.day < 11) sim.endDay();
    assert.deepEqual([sim.rotationNow().dept, !!sim.rotationNow().home], [r1, false]);
    assert.ok(sim.inbox().some((i) => i.title.includes('تدويرك')));
    while (sim.day < 16) sim.endDay();
    assert.equal(sim.rotationNow().dept, 'product');
    while (sim.day < 21) sim.endDay();
    assert.equal(sim.rotationNow().home, true);
  }
  assert.equal(newSim().rotationNow(), null, 'شهر المنتجات بلا تدوير حاليًا');
});
