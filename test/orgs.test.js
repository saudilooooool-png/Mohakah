import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMohakiServer } from '../src/server.js';
import { FileStore } from '../src/accounts/store.js';
import { goodRun } from '../scripts/lib/runs.js';

const ROOT = new URL('..', import.meta.url).pathname;

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-o-'));
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

test('حساب الجهة: إدارة محاكي تنشئها، ومديرها ينشئ الدفعات، والمتدرب ينضم برمز وموافقة', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const mgr = await user('مدير الأكاديمية', 'mgr@academy.sa');
    const t = await user('سارة العتيبي', 't@example.com');
    assert.equal((await mgr('POST', '/api/orgs', { name: 'أكاديمية' })).status, 403);
    const org = (await fac('POST', '/api/orgs', { name: 'أكاديمية التقنية', kind: 'academy', managers: 'mgr@academy.sa' })).data.org;
    assert.equal((await t('GET', `/api/orgs/${org.id}`)).status, 404, 'غير المدير لا يرى الجهة');
    const d = (await mgr('POST', `/api/orgs/${org.id}/cohorts`, { name: 'دفعة نوفمبر' })).data.org;
    const code = d.cohorts[0].code;
    assert.match(code, /^[A-Z2-9]{7}$/);
    assert.equal((await t('POST', '/api/orgs/join', { code: 'XXXXXXX', consent: true })).status, 404);
    assert.equal((await t('POST', '/api/orgs/join', { code })).status, 400, 'الموافقة مطلوبة');
    assert.equal((await t('POST', '/api/orgs/join', { code: code.toLowerCase(), consent: true })).data.membership.cohort, 'دفعة نوفمبر');
    assert.equal((await t('GET', '/api/orgs')).data.membership.org, 'أكاديمية التقنية');
    assert.equal((await mgr('GET', '/api/orgs')).data.managed.length, 1);
  });
});

test('لوحة الجهة: التقدم والنقاط وقرار التثبيت من الخادم، وتصدير CSV، والمغادرة توقف المشاركة', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const mgr = await user('مدير الأكاديمية', 'mgr@academy.sa');
    const [a, b, c] = [await user('سارة العتيبي', 'a@example.com'), await user('خالد الحربي', 'b@example.com'), await user('منى فهد', 'c@example.com')];
    const org = (await fac('POST', '/api/orgs', { name: 'أكاديمية التقنية', managers: 'mgr@academy.sa' })).data.org;
    const code = (await mgr('POST', `/api/orgs/${org.id}/cohorts`, { name: 'دفعة 1' })).data.org.cohorts[0].code;
    for (const t of [a, b, c]) await t('POST', '/api/orgs/join', { code, consent: true });
    await a('PUT', '/api/progress', goodRun(9, { scenario: 'sales-month' }));
    await b('PUT', '/api/progress', goodRun(9, { stopDay: 4 }));
    const co = (await mgr('GET', `/api/orgs/${org.id}`)).data.org.cohorts[0];
    assert.deepEqual(co.summary, { joined: 3, started: 2, finished: 1, confirmed: co.summary.confirmed, avgPoints: co.summary.avgPoints });
    const [first, second, third] = co.members;
    assert.deepEqual([first.name, first.finished, first.objectives.length > 0, first.role.includes('Sales')], ['سارة العتيبي', true, true, true]);
    assert.ok(first.decision);
    assert.deepEqual([second.name, second.day, second.decisionId], ['خالد الحربي', 5, 'in_progress']);
    assert.equal(third.started, false);
    assert.ok(!JSON.stringify(co).includes('transcript'), 'لا نصوص حوارات');
    assert.equal((await mgr('GET', `/api/orgs/${org.id}/export`)).status, 200);
    assert.equal((await a('GET', `/api/orgs/${org.id}/export`)).status, 404);
    await c('POST', '/api/orgs/leave');
    assert.equal((await mgr('GET', `/api/orgs/${org.id}`)).data.org.cohorts[0].members.length, 2);
  });
});

test('مهمة الجهة: مدير الدفعة ينشئها بمعاييره، والمتدرب يسلّم، والتقييم يظهر في اللوحة والسجل الموثّق', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const mgr = await user('مدرّب الأكاديمية', 'mgr@academy.sa');
    const [a, b] = [await user('سارة العتيبي', 'a@example.com'), await user('خالد الحربي', 'b@example.com')];
    const org = (await fac('POST', '/api/orgs', { name: 'أكاديمية التقنية', managers: 'mgr@academy.sa' })).data.org;
    const co = (await mgr('POST', `/api/orgs/${org.id}/cohorts`, { name: 'دفعة 1' })).data.org.cohorts[0];
    await a('POST', '/api/orgs/join', { code: co.code, consent: true });
    await a('PUT', '/api/progress', goodRun(9));
    const task = { cohortId: co.id, title: 'لوحة مؤشرات بـPower BI', brief: 'ابنِ لوحة مؤشرات لبيانات عملاء NOVA TECH تجيب عن سؤال خالد عن انخفاض الاستخدام.', criteria: 'صحة البيانات\nوضوح العرض\nالتوصية', unlockDay: 8, url: 'https://academy.sa/task' };
    assert.equal((await a('POST', `/api/orgs/${org.id}/tasks`, task)).status, 404, 'للمدير فقط');
    assert.equal((await mgr('POST', `/api/orgs/${org.id}/tasks`, { ...task, criteria: 'واحد' })).status, 400);
    const t = (await mgr('POST', `/api/orgs/${org.id}/tasks`, task)).data.org.cohorts[0].tasks[0];
    assert.deepEqual([t.criteria.length, t.unlockDay, t.summary.submitted], [3, 8, 0]);
    assert.equal((await b('GET', '/api/orgs/tasks')).data.tasks.length, 0, 'ليس عضوًا في الدفعة');
    assert.equal((await b('POST', `/api/orgs/tasks/${t.id}/submit`, { text: 'x'.repeat(50) })).status, 404);
    assert.equal((await a('GET', '/api/orgs/tasks')).data.tasks[0].title, task.title);
    assert.equal((await a('POST', `/api/orgs/tasks/${t.id}/submit`, { text: 'قصير' })).status, 400);
    const sub = { text: 'بنيت لوحة من ثلاث صفحات: الاستخدام حسب الشريحة، وزمن التحميل، والتوصية.', url: 'https://example.com/dash' };
    assert.equal((await a('POST', `/api/orgs/tasks/${t.id}/submit`, sub)).data.tasks[0].submission.url, sub.url);
    const uid = (await mgr('GET', `/api/orgs/${org.id}`)).data.org.cohorts[0].tasks[0].subs[0].userId;
    assert.equal((await mgr('POST', `/api/orgs/${org.id}/tasks/${t.id}/grade`, { userId: uid, scores: [5, 4] })).status, 400, 'كل المعايير');
    const g = (await mgr('POST', `/api/orgs/${org.id}/tasks/${t.id}/grade`, { userId: uid, scores: [5, 4, 3], feedback: 'عمل جيد، والتوصية تحتاج رقمًا.' })).data.org.cohorts[0];
    assert.deepEqual([g.tasks[0].summary.avg, g.members[0].tasks], [80, '80% (1)']);
    assert.equal((await a('POST', `/api/orgs/tasks/${t.id}/submit`, sub)).status, 409, 'لا تعديل بعد التقييم');
    assert.deepEqual((await a('GET', '/api/orgs/tasks')).data.tasks[0].grade.scores, [5, 4, 3]);
    const rec = (await a('POST', '/api/records/issue', {})).data;
    const code = rec.record?.code ?? rec.code;
    const pub = (await a('GET', `/api/records/${code}`)).data;
    assert.deepEqual([pub.orgTasks.count, pub.orgTasks.avg, pub.orgTasks.org], [1, 80, 'أكاديمية التقنية']);
  });
});

test('مهمة الجهة تُفتح في يوم العمل المحدد لها', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const a = await user('سارة العتيبي', 'a@example.com');
    const org = (await fac('POST', '/api/orgs', { name: 'أكاديمية' })).data.org;
    const co = (await fac('POST', `/api/orgs/${org.id}/cohorts`, { name: 'دفعة 1' })).data.org.cohorts[0];
    await a('POST', '/api/orgs/join', { code: co.code, consent: true });
    await fac('POST', `/api/orgs/${org.id}/tasks`, { cohortId: co.id, title: 'مهمة اليوم الثامن', brief: 'وصف المهمة التقنية المطلوبة من المتدرب في الأسبوع الثاني.', criteria: 'الدقة\nالوضوح', unlockDay: 8 });
    await a('PUT', '/api/progress', goodRun(9, { stopDay: 3 }));
    assert.equal((await a('GET', '/api/orgs/tasks')).data.tasks.length, 0);
    await a('PUT', '/api/progress', goodRun(9, { stopDay: 8 }));
    assert.equal((await a('GET', '/api/orgs/tasks')).data.tasks.length, 1);
  });
});
