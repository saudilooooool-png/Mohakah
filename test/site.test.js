import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMohakiServer } from '../src/server.js';
import { FileStore } from '../src/accounts/store.js';

const ROOT = new URL('..', import.meta.url).pathname;

async function withSite(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-site-'));
  process.env.MOHAKI_ADMIN_TOKEN = 'admin-secret';
  process.env.MOHAKI_LEADS_EMAIL = 'sales@example.com';
  const outbox = [];
  const store = new FileStore(dir);
  const server = createMohakiServer({ root: ROOT, dataDir: dir, store, mailer: { send: async (m) => { outbox.push(m); } } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, type: res.headers.get('content-type') };
  };
  try { await fn({ call, outbox, store }); } finally {
    server.close(); rmSync(dir, { recursive: true, force: true });
    delete process.env.MOHAKI_ADMIN_TOKEN; delete process.env.MOHAKI_LEADS_EMAIL;
  }
}

const lead = (extra = {}) => ({ offer: 'assessment', name: 'منى السبيعي', company: 'شركة تجريبية', email: 'mona@company.sa', consent: true, ...extra });

test('صفحات الموقع تُخدم بروابط قصيرة، والمنصة على /app/', async () => {
  await withSite(async ({ call }) => {
    for (const [path, text] of [['/', 'بيوم عمل'], ['/tamheer', 'تمهير'], ['/managers', 'كمدير'], ['/privacy', 'سياسة الخصوصية']]) {
      const r = await call('GET', path);
      assert.equal(r.status, 200, path);
      assert.ok(r.type.includes('text/html'));
      assert.ok(r.data.includes(text), path);
    }
    assert.equal((await call('GET', '/healthz')).data, 'ok');
    assert.equal((await call('GET', '/app/')).status, 200);
  });
});

test('طلب العرض: تحقق من الحقول والموافقة، وإشعار بالبريد، وحقل الفخ يُتجاهل', async () => {
  await withSite(async ({ call, outbox, store }) => {
    assert.equal((await call('POST', '/api/leads', lead({ email: 'x' }))).status, 400);
    assert.equal((await call('POST', '/api/leads', lead({ consent: false }))).status, 400);
    assert.equal((await call('POST', '/api/leads', lead({ company: '' }))).status, 400);
    assert.equal((await call('POST', '/api/leads', lead({ website: 'spam.com' }))).status, 200);
    assert.equal(store.leads.requests.length, 0, 'الفخ لا يُحفظ');
    assert.equal((await call('POST', '/api/leads', lead({ offer: 'tamheer', message: 'لدينا 12 متدربًا' }))).status, 200);
    assert.equal(store.leads.requests.length, 1);
    assert.equal(store.leads.requests[0].offer, 'tamheer');
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(outbox.at(-1).to, 'sales@example.com');
    assert.ok(outbox.at(-1).subject.includes('شركة تجريبية'));
  });
});

test('لوحة القياس: الزيارات والطلبات والتحويل لكل عرض، برمز المسؤول فقط', async () => {
  await withSite(async ({ call }) => {
    for (let i = 0; i < 4; i++) await call('POST', '/api/hit', { page: 'assessment' });
    await call('POST', '/api/hit', { page: 'managers' });
    await call('POST', '/api/hit', { page: 'unknown' });
    await call('POST', '/api/leads', lead());
    assert.equal((await call('GET', '/api/admin/leads')).status, 401);
    assert.equal((await call('GET', '/api/admin/leads', null, { Authorization: 'Bearer wrong' })).status, 401);
    const s = (await call('GET', '/api/admin/leads', null, { Authorization: 'Bearer admin-secret' })).data;
    assert.deepEqual([s.offers.assessment.visits, s.offers.assessment.requests, s.offers.assessment.conversion], [4, 1, 25]);
    assert.equal(s.offers.managers.visits, 1);
    assert.equal(s.offers.tamheer.conversion, null);
    assert.equal(s.requests[0].email, 'mona@company.sa');
  });
});

test('حد الإرسال: أكثر من 5 طلبات في الساعة من العنوان نفسه تُرفض', async () => {
  await withSite(async ({ call }) => {
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/leads', lead())).status, 200);
    assert.equal((await call('POST', '/api/leads', lead())).status, 429);
  });
});
