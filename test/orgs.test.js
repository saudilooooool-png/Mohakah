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
