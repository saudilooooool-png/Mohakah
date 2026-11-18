import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Simulation, loadCompany, loadScenario, computePoints } from '../src/index.js';
import { appraise, compliance, packOf, ratingOf } from '../src/rolepack.js';

const company = loadCompany('nova-tech');
const roles = Object.fromEntries(['pm', 'sales', 'cs'].map((r) => [r, JSON.parse(readFileSync(new URL(`../data/roles/${r}.json`, import.meta.url), 'utf8'))]));
const DOC = 'المشكلة انخفاض الاستخدام 41% مقابل 58%. البيانات والإيرادات والعملاء. السبب بطء. التوصية: نقترح ونوصي بالحل. الخيارات والبدائل. الميزانية والتكلفة والفريق. الجدول أسابيع على مراحل. مؤشر النجاح وقياس الهدف. المخاطر والتحديات. أنجزنا وأطلقنا. الخطوات القادمة. المستخدمين والشريحة. المتطلبات يجب. خارج النطاق لن نبني. أولًا أبدأ بالأولوية ثم قيمة ريال مرحلة احتمال، والخطوة اتصال وموعد، وأؤجل ما فيه مخاطر. 14 مندوب، سجل واتساب، 15% سنوي. احتياج نلبي ولا نلبي، السعر، خطة أسبوع، دعم محلي. استراتيجي، أصعّد للتطوير، أرد خلال ساعة، كلمة المرور. 1 2 3 مشكلة الحل، مثال، الدعم. اليوم الأول ترحيب، الأسبوع الأول استيراد، الشهر الأول مراجعة، مؤشر خطر، المسؤول. '.repeat(3);

function play(scenarioId, pick, { connect = [] } = {}) {
  const sim = new Simulation({ company, scenario: loadScenario(scenarioId), seed: 9 });
  while (!sim.finished) {
    if (sim.day === 11) for (const p of connect) sim.connect(p);
    for (const item of sim.inbox()) {
      if (item.research) { for (const [k, s] of Object.entries(item.research.sources)) if (!s.delay) sim.investigate(item.id, k); sim.submitResearch(item.id, Object.fromEntries(item.research.fields.map((f) => [f.id, f.correct]))); continue; }
      if (item.deliverable) { sim.submitDeliverable(item.id, DOC); continue; }
      const opts = [...item.options].sort((a, b) => b.quality - a.quality);
      const o = pick === 'best' ? opts[0] : opts.at(-1);
      sim.respond(item.id, o.id, { rationale: 'قرار مبني على البيانات وأثره على العملاء والفريق', ...(item.dialogue && pick === 'best' ? { addressed: item.dialogue.concerns.map((c) => c.id), transcript: [{ speaker: 'trainee', text: 'رد' }] } : {}) });
    }
    sim.endDay();
  }
  return sim;
}

test('حزمة الدور: لكل دور وصف وظيفي وأهداف وصلاحيات وإجراءات، وقواعد التجاوز تشير لأحداث وخيارات موجودة', () => {
  for (const [id, pack] of Object.entries(roles)) {
    assert.ok(pack.purpose && pack.responsibilities.length >= 4 && pack.kpis.length >= 3, id);
    assert.equal(pack.objectives.length, 5);
    assert.ok(pack.authority.length >= 4 && pack.sops.length >= 3);
    const sc = loadScenario(pack.scenario);
    assert.equal(packOf(roles, sc.id).id, id);
    const events = [...sc.events, ...sc.randomEvents];
    for (const r of pack.compliance) {
      const e = events.find((x) => x.id === r.event);
      assert.ok(e, `${id}: ${r.event}`);
      assert.ok(e.options.some((o) => o.id === r.option), `${id}: ${r.event}/${r.option}`);
    }
  }
  assert.deepEqual([ratingOf(90).rating, ratingOf(72).rating, ratingOf(30).rating], [5, 4, 1]);
});

test('قرار التثبيت: المجتهد يُثبَّت، والضعيف يعيد، والتجاوزات تُسجَّل بقاعدتها', () => {
  for (const [id, pack] of Object.entries(roles)) {
    const good = play(pack.scenario, 'best', { connect: ['eng_lead', 'cs_lead', 'cpo', 'analyst'] });
    const a = appraise(pack, good, computePoints(good.report(), { finished: true }));
    assert.equal(a.decision.id, 'confirmed', `${id}: ${a.decision.text} ${JSON.stringify(a.objectives)}`);
    assert.equal(a.violations.length, 0);
    assert.ok(a.competencies.every((c) => c.rating === null || c.rating >= 3));
    const bad = play(pack.scenario, 'worst');
    const b = appraise(pack, bad, computePoints(bad.report(), { finished: true }));
    assert.notEqual(b.decision.id, 'confirmed', id);
    assert.ok(b.development.length === 2 && b.development[0].action);
    assert.ok(compliance(pack, bad).length >= 1, `${id}: الأسوأ يتجاوز`);
    assert.ok(b.violations.every((v) => v.rule && ['authority', 'sop'].includes(v.kind)));
  }
});

test('قبل إكمال الفترة: القرار "قيد التجربة" والأهداف تُقاس حيًّا', () => {
  const sim = new Simulation({ company, scenario: loadScenario('pm-first-30-days'), seed: 3 });
  for (let i = 0; i < 4; i++) sim.endDay();
  const a = appraise(roles.pm, sim, computePoints(sim.report(), { finished: false }));
  assert.equal(a.decision.id, 'in_progress');
  assert.equal(a.objectives.find((o) => o.id === 'reports').actual, 'لم يتم بعد');
});

test('التقرير الأسبوعي: كل خميس، بنصف ساعة، ولا يدخل في جودة المخرجات، ويظهر في تقييم الأداء', async () => {
  const { Simulation, loadCompany, loadScenario, loadOccupations } = await import('../src/index.js');
  const { goodRun: run } = await import('../scripts/lib/runs.js');
  const { replay } = await import('../src/replay.js');
  const w = { company: loadCompany('nova-tech'), scenario: loadScenario('cs-month'), occupations: loadOccupations() };
  const sim = new Simulation({ ...w, seed: 4 });
  while (sim.day < 5) sim.endDay();
  const item = sim.inbox().find((i) => i.weekly === 1);
  assert.ok(item, 'يصل يوم الخميس الأول');
  assert.equal(sim.costOf(item), 0.5);
  const before = sim.hoursLeft;
  const ev = sim.submitDeliverable(item.id, 'أنجزت هذا الأسبوع قراءة دليل الموظف وأغلقت 12 تذكرة ورفعت مقال قاعدة المعرفة. الأسبوع القادم سأعمل على فرز التذاكر المتأخرة ومتابعة عميلين. لا عوائق حاليًا، وأحتاج صلاحية الاطلاع على لوحة التذاكر. '.repeat(2));
  assert.equal(ev.score, 1);
  assert.equal(before - sim.hoursLeft, 0.5);
  while (sim.day < 11) sim.endDay(); // التقرير الثاني يفوت
  const r = sim.report();
  assert.deepEqual(r.evidence.weekly, { due: 2, submitted: 1, good: 1 });
  assert.ok(!r.evidence.deliverables.some((d) => String(d.event).startsWith('weekly_')));
  const full = replay(w, run(9, { scenario: 'cs-month' })).sim;
  assert.deepEqual(full.report().evidence.weekly, { due: 5, submitted: 5, good: 5 });
  assert.equal(new Simulation({ ...w, scenario: loadScenario('cs-assessment'), seed: 1 }).events.some((e) => e.weekly), false, 'لا تقرير أسبوعي في جلسة التقييم القصيرة');
});
