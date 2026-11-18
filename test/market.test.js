import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMohakiServer } from '../src/server.js';
import { FileStore } from '../src/accounts/store.js';

const ROOT = new URL('..', import.meta.url).pathname;

async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-m-'));
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

const Q = (extra = {}) => ({ title: 'سعر نظام منافس', question: 'كم السعر الشهري للمستخدم في الباقة الأساسية لنظام س؟ أرفق صفحة الأسعار.', type: 'number', unit: 'ر.س', tolerancePct: 10, points: 20, slots: 5, minDays: 0, ...extra });

test('بحث السوق: الأغلبية المتطابقة من مصادر مختلفة تعتمد الجواب، والنقاط لمن طابق', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const ts = [];
    for (const n of ['أ', 'ب', 'ج', 'د']) ts.push(await user(`متدرب ${n}`, `${n}@example.com`));
    assert.equal((await ts[0]('POST', '/api/market', Q())).status, 403);
    const q = (await fac('POST', '/api/market', Q())).data.question;
    assert.equal((await ts[0]('POST', `/api/market/${q.id}/answer`, { value: 75 })).status, 400, 'المصدر مطلوب');
    let v = (await ts[0]('POST', `/api/market/${q.id}/answer`, { value: 75, sourceUrl: 'https://vendor.example/pricing' })).data.question;
    assert.deepEqual([v.status, v.result], ['open', null], 'لا نتيجة قبل اكتمال الحد الأدنى');
    assert.equal((await ts[0]('POST', `/api/market/${q.id}/answer`, { value: 80, sourceUrl: 'https://x.example/a' })).status, 409);
    await ts[1]('POST', `/api/market/${q.id}/answer`, { value: 79, sourceUrl: 'https://reviews.example/s' });
    v = (await ts[2]('POST', `/api/market/${q.id}/answer`, { value: 150, sourceUrl: 'https://blog.example/old' })).data.question;
    assert.equal(v.status, 'consensus');
    assert.equal(v.result.value, 79, 'الوسيط');
    assert.equal(v.mine.matched, false);
    assert.equal((await ts[0]('GET', '/api/market/summary')).data.points, 20);
    assert.equal((await ts[2]('GET', '/api/market/summary')).data.points, 0);
    // من لم يجب لا يرى السؤال المحسوم ولا نتيجته
    assert.equal((await ts[3]('GET', '/api/market')).data.questions.length, 0);
    const all = (await fac('GET', '/api/market')).data.questions[0].all;
    assert.equal(all.length, 3);
    // تظهر في السجل الموثّق دون أن تغيّر نقاط المحاكاة
    const { goodRun } = await import('../scripts/lib/runs.js');
    await ts[0]('PUT', '/api/progress', goodRun(9));
    const rec = (await ts[0]('POST', '/api/records/issue')).data;
    assert.deepEqual([rec.marketResearch.confirmed, rec.marketResearch.points, rec.marketResearch.items[0].title], [1, 20, 'سعر نظام منافس']);
    assert.ok(rec.points > 700);
    assert.equal((await ts[0]('GET', '/api/work/summary')).data.market.points, 20);
  });
});

test('بحث السوق: التطابق من موقع واحد لا يُعتمد تلقائيًا، والمُيسِّر يحسم أو يصحح', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const ts = [];
    for (const n of ['أ', 'ب', 'ج']) ts.push(await user(`متدرب ${n}`, `${n}@example.com`));
    const q = (await fac('POST', '/api/market', Q({ type: 'choice', options: 'شهري\nسنوي\nلكل مستخدم' }))).data.question;
    for (const t of ts.slice(0, 2)) await t('POST', `/api/market/${q.id}/answer`, { value: 'شهري', sourceUrl: 'https://same.example/page' });
    const v = (await ts[2]('POST', `/api/market/${q.id}/answer`, { value: 'شهري', sourceUrl: 'https://www.same.example/other' })).data.question;
    assert.deepEqual([v.status, v.result], ['same_source', null]);
    assert.equal((await ts[0]('GET', '/api/market/summary')).data.points, 0);
    await fac('POST', `/api/market/${q.id}/confirm`, { value: 'لكل مستخدم' });
    assert.equal((await ts[0]('GET', '/api/market/summary')).data.points, 0, 'الأغلبية كانت على خطأ');
    await fac('POST', `/api/market/${q.id}/confirm`, { value: 'شهري' });
    assert.deepEqual((await ts[0]('GET', '/api/market/summary')).data, { answered: 1, confirmed: 1, points: 20 });
  });
});
