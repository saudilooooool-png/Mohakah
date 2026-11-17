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
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-s-'));
  const outbox = [];
  const store = new FileStore(dir);
  const server = createMohakiServer({ root: ROOT, dataDir: dir, store, mailer: { send: async (m) => { outbox.push(m); } } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const user = async (name, email) => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data };
    };
    if (name) await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
    return call;
  };
  try { await fn({ user, store, base }); } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('التحدي: يُنشأ بعد يوم عمل، ويظهر للعامة بالاسم الأول والنقاط فقط', async () => {
  await withServer(async ({ user }) => {
    const owner = await user('سارة العتيبي', 'sara@example.com');
    assert.equal((await owner('POST', '/api/challenges')).status, 400, 'تحدٍّ دون تقدم');
    const run = goodRun(9);
    await owner('PUT', '/api/progress', run);
    const c = (await owner('POST', '/api/challenges')).data.challenge;
    assert.match(c.code, /^[A-Z2-9]{6}$/);
    assert.equal(c.seed, 9);
    assert.equal(c.owner.finished, true);
    assert.ok(c.owner.points > 700);
    // إعادة الطلب تعيد التحدي نفسه
    assert.equal((await owner('POST', '/api/challenges')).data.challenge.code, c.code);
    const guest = await user();
    const pub = (await guest('GET', `/api/challenges/${c.code}`)).data.challenge;
    assert.equal(pub.owner.name, 'سارة');
    assert.ok(!JSON.stringify(pub).includes('العتيبي') && !JSON.stringify(pub).includes('@'), 'تسريب الاسم الكامل أو البريد');
    assert.equal(pub.participants, 0);
  });
});

test('التحدي: المنضم يلعب البذرة نفسها ويظهر في اللوحة مرتبًا، والبذرة المختلفة لا تُقبل', async () => {
  await withServer(async ({ user }) => {
    const owner = await user('سارة العتيبي', 'sara@example.com');
    await owner('PUT', '/api/progress', goodRun(9));
    const { code } = (await owner('POST', '/api/challenges')).data.challenge;
    const friend = await user('خالد', 'khalid@example.com');
    const partial = goodRun(9, { stopDay: 3 });
    await friend('PUT', '/api/progress', { ...partial, challenge: code });
    const cheat = await user('مازن', 'mazen@example.com');
    await cheat('PUT', '/api/progress', { ...goodRun(5), challenge: code }); // بذرة أخرى: لا يُقبل
    const board = (await friend('GET', `/api/challenges/${code}`)).data.challenge.board;
    assert.equal(board.length, 2);
    assert.equal(board[0].owner, true);
    assert.equal(board[1].name, 'خالد');
    assert.equal(board[1].you, true);
    assert.equal(board[1].days, 3);
    assert.equal((await friend('GET', '/api/progress')).data.progress.challenge, code);
  });
});

test('التحدي: صاحبه يلغيه فيتوقف الرابط، وغيره لا يستطيع', async () => {
  await withServer(async ({ user }) => {
    const owner = await user('سارة', 'sara@example.com');
    await owner('PUT', '/api/progress', goodRun(9, { stopDay: 2 }));
    const { code } = (await owner('POST', '/api/challenges')).data.challenge;
    const other = await user('خالد', 'khalid@example.com');
    assert.equal((await other('DELETE', `/api/challenges/${code}`)).status, 404);
    assert.equal((await owner('DELETE', `/api/challenges/${code}`)).status, 200);
    assert.equal((await other('GET', `/api/challenges/${code}`)).status, 404);
  });
});

test('رابط المشاركة /c/CODE يعطي معاينة بعنوان النتيجة ثم يحوّل إلى التطبيق', async () => {
  await withServer(async ({ user }) => {
    const owner = await user('سارة العتيبي', 'sara@example.com');
    await owner('PUT', '/api/progress', goodRun(9));
    const { code, owner: o } = (await owner('POST', '/api/challenges')).data.challenge;
    const page = (await owner('GET', `/c/${code}`)).data;
    assert.ok(page.includes('og:title'));
    assert.ok(page.includes(`سارة: أنهيت شهري مديرًا للمنتجات بـ${o.points} نقطة`));
    assert.ok(page.includes(`/app/#/challenge/${code}`));
    assert.ok(!page.includes('العتيبي'));
  });
});
