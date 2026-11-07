import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Simulation, loadCompany, loadScenario, loadOccupations, replay, computePoints } from '../src/index.js';
import { createAccountsApi, hashPassword, verifyPassword } from '../src/accounts/api.js';
import { FileStore } from '../src/accounts/store.js';

const world = { company: loadCompany('nova-tech'), scenario: loadScenario('pm-first-30-days'), occupations: loadOccupations() };

/** متدرب جيد: أفضل خيار في كل بند، ويكتب المستندات (سجل أفعال كما يحفظه المتصفح). */
function goodRun(seed = 9) {
  const sim = new Simulation({ ...world, seed });
  const log = [];
  const doc = 'المشكلة انخفاض الاستخدام 41% مقابل 58%. البيانات والإيرادات والعملاء. السبب بطء. التوصية: نقترح ونوصي بالحل. الخيارات والبدائل. الميزانية والتكلفة والفريق. الجدول أسابيع على مراحل. مؤشر النجاح وقياس الهدف. المخاطر والتحديات. أنجزنا وأطلقنا. الخطوات القادمة. المستخدمين والشريحة. المتطلبات يجب. خارج النطاق لن نبني. '.repeat(3);
  while (!sim.finished) {
    for (const item of sim.inbox()) {
      if (item.deliverable) { sim.submitDeliverable(item.id, doc); log.push({ t: 'deliver', itemId: item.id, text: doc }); continue; }
      const best = [...item.options].sort((a, b) => b.quality - a.quality)[0];
      const extra = item.dialogue ? { addressed: item.dialogue.concerns.map((c) => c.id), transcript: [{ speaker: 'trainee', text: 'رد مدروس' }] } : {};
      const rationale = 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات في هذه المرحلة من عمر الشركة';
      sim.respond(item.id, best.id, { rationale, ...extra });
      log.push({ t: 'respond', itemId: item.id, optionId: best.id, rationale, ...extra });
    }
    sim.endDay(); log.push({ t: 'endDay' });
  }
  return { seed, log, sim };
}

async function withServer(fn, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-'));
  const api = createAccountsApi({ store: new FileStore(dir), world, env });
  const server = createServer(async (req, res) => { if (!(await api(req, res))) { res.writeHead(404); res.end(); } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
  try { await fn(call, () => { cookie = ''; }); } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

const reg = (extra = {}) => ({ name: 'سارة العتيبي', email: 'sara@example.com', password: 'secret-123', profile: { university: 'جامعة الملك سعود', major: 'نظم معلومات', graduationYear: 2026, city: 'الرياض' }, consents: { processing: true, employerSharing: true }, ...extra });

test('كلمات المرور تُخزن مجزأة (scrypt) ويُتحقق منها بأمان', () => {
  const h = hashPassword('secret-123');
  assert.ok(h.startsWith('scrypt$') && !h.includes('secret-123'));
  assert.ok(verifyPassword('secret-123', h));
  assert.ok(!verifyPassword('wrong-pass', h));
});

test('النقاط: أوزان معلنة من 1000، وشرائح، وشروط التوصية', () => {
  const { sim } = goodRun();
  const p = computePoints(sim.report(), { finished: true });
  assert.ok(p.points > 0 && p.points <= 1000);
  assert.equal(p.breakdown.reduce((s, b) => s + b.weight, 0), 100);
  assert.ok(['متميز', 'جاهز لسوق العمل', 'واعد', 'قيد التطوير'].includes(p.band.label));
  assert.equal(computePoints(sim.report(), { finished: false }).recommendable, false, 'لا توصية قبل الإكمال');
});

test('إعادة التشغيل على الخادم تعطي التقرير نفسه بالضبط', () => {
  const { seed, log, sim } = goodRun(11);
  const { sim: again } = replay(world, { seed, log }, { strict: true });
  assert.deepEqual(again.report().skills, sim.report().skills);
});

test('التسجيل: الاسم والبريد وكلمة المرور والموافقة على المعالجة مطلوبة', async () => {
  await withServer(async (call) => {
    assert.equal((await call('POST', '/api/auth/register', reg({ consents: { processing: false } }))).status, 400);
    assert.equal((await call('POST', '/api/auth/register', reg({ password: '123' }))).status, 400);
    const ok = await call('POST', '/api/auth/register', reg());
    assert.equal(ok.status, 200);
    assert.equal(ok.data.consents.employerSharing, true);
    assert.equal(ok.data.passwordHash, undefined, 'لا تسريب لتجزئة كلمة المرور');
    assert.equal((await call('POST', '/api/auth/register', reg())).status, 409);
    assert.equal((await call('GET', '/api/me')).data.user.email, 'sara@example.com');
  });
});

test('الدخول والخروج، والمسارات المحمية تتطلب جلسة', async () => {
  await withServer(async (call, clear) => {
    await call('POST', '/api/auth/register', reg());
    await call('POST', '/api/auth/logout');
    assert.equal((await call('GET', '/api/progress')).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email: 'sara@example.com', password: 'nope-nope' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { email: 'SARA@example.com', password: 'secret-123' })).status, 200);
    assert.equal((await call('GET', '/api/progress')).status, 200);
    clear();
    assert.equal((await call('GET', '/api/me')).data.user, null);
  });
});

test('السجل لا يُصدر قبل الإكمال، ويُصدر بعده بنتيجة يحسبها الخادم', async () => {
  await withServer(async (call) => {
    await call('POST', '/api/auth/register', reg());
    const { seed, log, sim } = goodRun();
    await call('PUT', '/api/progress', { seed, log: log.slice(0, 20), startedAt: '2026-11-01' });
    assert.equal((await call('POST', '/api/records/issue')).status, 400);
    await call('PUT', '/api/progress', { seed, log, startedAt: '2026-11-01' });
    const issued = await call('POST', '/api/records/issue');
    assert.equal(issued.status, 200);
    const expected = computePoints(sim.report(), { finished: true });
    assert.equal(issued.data.points, expected.points);
    assert.match(issued.data.code, /^MHK-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.equal(issued.data.occupation.code, '122302');
    assert.equal((await call('POST', '/api/records/issue')).data.code, issued.data.code, 'لا تكرار للسجل نفسه');
    const pub = await call('GET', `/api/records/${issued.data.code}`);
    assert.equal(pub.data.name, 'سارة العتيبي');
    assert.equal(pub.data.userId, undefined);
    assert.equal(pub.data.email, undefined, 'صفحة التحقق لا تكشف البريد');
  });
});

test('التلاعب: فعل غير صالح في السجل يمنع الإصدار', async () => {
  await withServer(async (call) => {
    await call('POST', '/api/auth/register', reg());
    const { seed, log } = goodRun();
    const forged = log.map((a, i) => (i === 3 && a.t === 'respond' ? { ...a, optionId: 'make_me_ceo' } : a));
    await call('PUT', '/api/progress', { seed, log: forged });
    const res = await call('POST', '/api/records/issue');
    assert.equal(res.status, 422);
  });
});

test('جهات التوظيف: الموافقون المؤهلون فقط، وبرمز وصول، والسحب يخفي المرشح', async () => {
  await withServer(async (call) => {
    await call('POST', '/api/auth/register', reg());
    const { seed, log } = goodRun();
    await call('PUT', '/api/progress', { seed, log });
    const rec = (await call('POST', '/api/records/issue')).data;
    assert.equal((await call('GET', '/api/talent')).status, 401);
    const list = (await call('GET', '/api/talent', null, { authorization: 'Bearer emp-token' })).data.candidates;
    assert.equal(rec.recommendable, true, 'المتدرب الجيد مؤهل للتوصية');
    assert.equal(list.length, 1);
    assert.equal(list[0].university, 'جامعة الملك سعود');
    assert.equal(list[0].code, rec.code);
    await call('PATCH', '/api/me', { consents: { employerSharing: false } });
    assert.equal((await call('GET', '/api/talent', null, { authorization: 'Bearer emp-token' })).data.candidates.length, 0);
  }, { MOHAKI_EMPLOYER_TOKEN: 'emp-token' });
});

test('حق الحذف: يحذف الحساب ويُلغي السجلات الصادرة', async () => {
  await withServer(async (call) => {
    await call('POST', '/api/auth/register', reg());
    const { seed, log } = goodRun();
    await call('PUT', '/api/progress', { seed, log });
    const rec = (await call('POST', '/api/records/issue')).data;
    assert.equal((await call('DELETE', '/api/me')).status, 200);
    const pub = (await call('GET', `/api/records/${rec.code}`)).data;
    assert.equal(pub.revoked, true);
    assert.equal(pub.name, undefined);
    assert.equal((await call('POST', '/api/auth/login', { email: 'sara@example.com', password: 'secret-123' })).status, 401);
  });
});

test('طلبات غير JSON مرفوضة (حماية من إرسال النماذج من مواقع أخرى)', async () => {
  await withServer(async (call) => {
    assert.equal((await call('POST', '/api/auth/register', reg(), { 'Content-Type': 'text/plain' })).status, 415);
  });
});
