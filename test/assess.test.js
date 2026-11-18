import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMohakiServer } from '../src/server.js';
import { FileStore } from '../src/accounts/store.js';
import { readFileSync } from 'node:fs';
import { world, DOC } from '../scripts/lib/runs.js';
import { Simulation } from '../src/index.js';

const ROOT = new URL('..', import.meta.url).pathname;

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-as-'));
  process.env.MOHAKI_FACILITATORS = 'fac@example.com';
  process.env.MOHAKI_ADMIN_TOKEN = 'adm';
  const outbox = [];
  const store = new FileStore(dir);
  const server = createMohakiServer({ root: ROOT, dataDir: dir, store, mailer: { send: async (m) => { outbox.push(m); } } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const user = async (name, email) => {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    if (name) {
      await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
      const link = [...outbox].reverse().find((m) => m.to === email && m.link?.includes('confirm-email')).link;
      await call('POST', '/api/auth/verify', { token: link.split('/').pop() });
    }
    return call;
  };
  try { await fn({ user, store }); } finally {
    server.close(); rmSync(dir, { recursive: true, force: true });
    delete process.env.MOHAKI_FACILITATORS; delete process.env.MOHAKI_ADMIN_TOKEN;
  }
}

const play = (seed, { good = true, days = 3, role = 'pm' } = {}) => {
  const world2 = { ...world, scenario: JSON.parse(readFileSync(new URL(`../data/scenarios/${role}-assessment.json`, import.meta.url), 'utf8')) };
  const sim = new Simulation({ ...world2, seed });
  const log = [];
  for (let d = 0; d < days && !sim.finished; d++) {
    for (const item of sim.inbox()) {
      if (item.deliverable) { const text = good ? DOC : 'سأنظر في الأمر لاحقًا إن شاء الله وأعود لكم بالتفاصيل قريبًا جدًا.'; sim.submitDeliverable(item.id, text); log.push({ t: 'deliver', itemId: item.id, text }); continue; }
      const opts = [...item.options].sort((a, b) => b.quality - a.quality);
      const o = good ? opts[0] : opts.at(-1);
      sim.respond(item.id, o.id, { rationale: 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات' });
      log.push({ t: 'respond', itemId: item.id, optionId: o.id, rationale: 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات' });
    }
    sim.endDay(); log.push({ t: 'endDay' });
  }
  return log;
};

test('جلسة التقييم: المُيسِّر ينشئها بروابط للمرشحين ورابط تقرير، والمرشح يدخل بلا حساب', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const guest = await user();
    assert.equal((await guest('POST', '/api/assess', { company: 'شركة', candidates: [{ name: 'أحمد' }] })).status, 403);
    const a = (await fac('POST', '/api/assess', { company: 'شركة التقنية', title: 'مدير منتجات', candidates: [{ name: 'أحمد سالم', email: 'a@x.sa' }, { name: 'منى فهد' }] })).data.assessment;
    assert.equal(a.candidates.length, 2);
    assert.match(a.candidates[0].link, /\/a\/[a-f0-9]{24}$/);
    assert.match(a.reportLink, /\/r\/[a-f0-9]{24}$/);
    const t = a.candidates[0].link.split('/').pop();
    const v = (await guest('GET', `/api/assess/c/${t}`)).data.assessment;
    assert.deepEqual([v.name, v.company, v.startedAt, v.finished], ['أحمد سالم', 'شركة التقنية', null, false]);
    assert.equal((await guest('PUT', `/api/assess/c/${t}/progress`, { log: [] })).status, 409, 'لا حفظ قبل البدء');
    assert.equal((await guest('POST', `/api/assess/c/${t}/start`, {})).status, 400, 'الموافقة مطلوبة');
    assert.ok((await guest('POST', `/api/assess/c/${t}/start`, { consent: true })).data.assessment.startedAt);
    assert.equal((await guest('GET', '/api/assess/c/000000000000000000000000')).status, 404);
  });
});

test('جلسة التقييم: العالم نفسه للجميع، والتقرير يرتب المرشحين بنتيجة يحسبها الخادم، ويُقفل بعد التسليم', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const guest = await user();
    const a = (await fac('POST', '/api/assess', { company: 'شركة التقنية', candidates: [{ name: 'قوي' }, { name: 'ضعيف' }, { name: 'لم يبدأ' }] })).data.assessment;
    const [t1, t2] = a.candidates.map((c) => c.link.split('/').pop());
    const seed = (await guest('GET', `/api/assess/c/${t1}`)).data.assessment.seed;
    assert.equal(seed, (await guest('GET', `/api/assess/c/${t2}`)).data.assessment.seed, 'بذرة واحدة');
    await guest('POST', `/api/assess/c/${t1}/start`, { consent: true });
    await guest('POST', `/api/assess/c/${t2}/start`, { consent: true });
    assert.equal((await guest('PUT', `/api/assess/c/${t1}/progress`, { log: [{ t: 'respond', itemId: 'nope', optionId: 'x' }] })).status, 422, 'سجل مزوّر');
    assert.equal((await guest('PUT', `/api/assess/c/${t1}/progress`, { log: play(seed) })).data.finished, true);
    assert.equal((await guest('PUT', `/api/assess/c/${t1}/progress`, { log: play(seed) })).status, 409, 'مقفل بعد التسليم');
    assert.equal((await guest('GET', `/api/assess/c/${t1}`)).data.assessment.progress, null, 'لا يُعاد التقدم بعد التسليم');
    await guest('PUT', `/api/assess/c/${t2}/progress`, { log: play(seed, { good: false, days: 2 }) });
    const r = (await guest('GET', `/api/assess/report/${a.reportLink.split('/').pop()}`)).data.report;
    assert.deepEqual(r.summary, { invited: 3, started: 2, finished: 1 });
    assert.deepEqual(r.candidates.map((c) => c.name), ['قوي', 'ضعيف', 'لم يبدأ']);
    assert.ok(r.candidates[0].points > r.candidates[1].points + 100);
    assert.equal(r.candidates[0].status, 'finished');
    assert.ok(r.candidates[0].deliverables[0].text.length > 50 && r.candidates[0].decisions.length >= 8);
    assert.equal(r.candidates[2].points, undefined);
    assert.equal((await guest('GET', '/api/assess/report/000000000000000000000000')).status, 404);
  });
});

test('أدوار التقييم: مبيعات وخدمة عملاء بسيناريو خاص لكل دور، والحوارات متسقة', async () => {
  const { validateDialogueSpec, openMeeting, offlineTurn, applyTurn, offlineClose } = await import('../src/agents/meeting.js');
  const scen = (r) => JSON.parse(readFileSync(new URL(`../data/scenarios/${r}-assessment.json`, import.meta.url), 'utf8'));
  for (const r of ['pm', 'sales', 'cs']) for (const e of scen(r).events.filter((x) => x.dialogue)) assert.deepEqual(validateDialogueSpec(e, world.company.people), [], `${r}/${e.id}`);
  // الوضع المحلي: الرد الجيد والرد الضعيف يصلان إلى نتيجتين مختلفتين
  const run = (e, msgs) => { let m = openMeeting({ id: e.id, eventId: e.id, dialogue: e.dialogue }); for (const t of msgs) m = applyTurn(m, t, offlineTurn(e.dialogue, m, t)); return offlineClose(e.dialogue, m).decision; };
  const ev = (r, id) => scen(r).events.find((x) => x.id === id);
  assert.equal(run(ev('sales', 's_discovery'), ['كم مندوبًا في فريقكم، وكيف تتابعون العملاء حاليًا؟', 'أقترح عرضًا تجريبيًا يوم الأحد مع المدير العام.']), 'qualified');
  assert.equal(run(ev('sales', 's_discovery'), ['نظامنا أفضل نظام وفيه مزايا كثيرة.']), 'pitch');
  assert.equal(run(ev('sales', 's_promise'), ['أعدك أنها ستكون جاهزة خلال شهر.']), 'promise');
  assert.equal(run(ev('sales', 's_discount'), ['عميل واحد يضيع شهريًا يغطي الاشتراك. أعرض 15% مقابل التزام سنوي.']), 'trade');
  assert.equal(run(ev('cs', 'c_escalation'), ['الخلل أصاب 12 عميلًا منهم رواسي، و19 تذكرة. أطلب حلًا مؤقتًا وموعدًا، وأرسل لك ملف مثال.']), 'case');
  assert.equal(run(ev('cs', 'c_onboarding'), ['انظري المقال في مركز المساعدة.']), 'link');
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const guest = await user();
    const a = (await fac('POST', '/api/assess', { company: 'شركة', role: 'sales', candidates: [{ name: 'بائع' }] })).data.assessment;
    assert.deepEqual([a.role, a.title], ['sales', 'أخصائي مبيعات']);
    const t = a.candidates[0].link.split('/').pop();
    const v = (await guest('POST', `/api/assess/c/${t}/start`, { consent: true })).data.assessment;
    assert.equal(v.scenario, 'sales-assessment');
    assert.equal((await guest('PUT', `/api/assess/c/${t}/progress`, { log: play(v.seed, { role: 'pm' }) })).status, 422, 'سجل دور آخر لا يُقبل');
    assert.equal((await guest('PUT', `/api/assess/c/${t}/progress`, { log: play(v.seed, { role: 'sales' }) })).data.finished, true);
    const r = (await guest('GET', `/api/assess/report/${a.reportLink.split('/').pop()}`)).data.report;
    assert.ok(r.role.includes('Sales') && r.candidates[0].points > 600);
  });
});
