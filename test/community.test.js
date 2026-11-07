import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountsApi } from '../src/accounts/api.js';
import { FileStore } from '../src/accounts/store.js';
import { createCommunityApi } from '../src/community/api.js';

import { world, DOC, goodRun } from '../scripts/lib/runs.js';

/** خادم بالحسابات والمجتمع، وعملاء متعددون (لكل منهم ملف تعريف ارتباط). */
export async function withCommunity(fn, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-c-'));
  const outbox = [];
  const store = new FileStore(dir);
  const accountsApi = createAccountsApi({ store, world, env: { MOHAKI_FACILITATORS: 'fac@example.com', ...env }, mailer: { send: async (m) => { outbox.push(m); } } });
  const communityApi = createCommunityApi({ store, world, accountsApi });
  const server = createServer(async (req, res) => { if (!(await accountsApi(req, res)) && !(await communityApi(req, res))) { res.writeHead(404); res.end('{}'); } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const client = () => {
    let cookie = '';
    const call = async (method, path, body) => {
      const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    return call;
  };
  /** حساب مؤكد البريد. */
  const user = async (name, email) => {
    const call = client();
    const r = await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
    const link = [...outbox].reverse().find((m) => m.to === email && m.link?.includes('confirm-email')).link;
    await call('POST', '/api/auth/verify', { token: link.split('/').pop() });
    call.id = r.data.id;
    return call;
  };
  try { await fn({ user, store }); } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

// ——— 1) لوحة المُيسِّر ———

test('المُيسِّر: الدور من قائمة البريد المؤكد، والمتدرب لا يدخل اللوحة', async () => {
  await withCommunity(async ({ user }) => {
    const fac = await user('هيا المُيسِّرة', 'fac@example.com');
    const tr = await user('خالد المتدرب', 'tr@example.com');
    assert.equal((await fac('GET', '/api/me')).data.user.role, 'facilitator');
    assert.equal((await tr('GET', '/api/me')).data.user.role, 'trainee');
    assert.equal((await tr('GET', '/api/facilitator/dialogues')).status, 403);
    assert.equal((await fac('GET', '/api/facilitator/dialogues')).status, 200);
  });
});

test('المُيسِّر يرى حوارات المتدربين بالمحضر وحكم الوكيل، ويصحح الحكم فيتغير السجل الموثّق', async () => {
  await withCommunity(async ({ user }) => {
    const fac = await user('هيا المُيسِّرة', 'fac@example.com');
    const tr = await user('خالد المتدرب', 'tr@example.com');
    const { seed, log } = goodRun(9);
    await tr('PUT', '/api/progress', { seed, log });
    const before = (await tr('POST', '/api/records/issue')).data;
    const list = (await fac('GET', '/api/facilitator/dialogues')).data.dialogues;
    assert.ok(list.length >= 17, 'كل الحوارات المجدولة على الأقل');
    const d = list.find((x) => x.eventId === 'd5_mgmt_meeting');
    assert.equal(d.userName, 'خالد المتدرب');
    assert.deepEqual(d.ai.addressed.sort(), ['customers', 'roi', 'timeline']);
    // المُيسِّر يرى أن الدفاع لم يكن مقنعًا: اعتراض واحد فقط، والنتيجة تراجع
    const r = await fac('POST', '/api/facilitator/review', { userId: d.userId, itemId: d.itemId, addressed: ['roi'], optionId: 'give_in', note: 'الرد عام ولم يجب المبيعات ولا التطوير' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.review.ai.addressed.sort(), ['customers', 'roi', 'timeline'], 'حكم الوكيل الأصلي محفوظ للتدقيق');
    const after = (await tr('POST', '/api/records/issue')).data;
    assert.notEqual(after.code, before.code, 'سجل جديد بعد التصحيح');
    assert.ok(after.points < before.points, `${after.points} < ${before.points}`);
    const prog = (await tr('GET', '/api/progress')).data.progress;
    assert.equal(prog.reviews[d.itemId].optionId, 'give_in', 'المتصفح يستلم التصحيح مع التقدم');
    assert.equal((await fac('GET', '/api/facilitator/dialogues')).data.dialogues.some((x) => x.itemId === d.itemId), false, 'خرج من قائمة غير المراجعة');
  });
});

test('تصحيح يغيّر مسار الأحداث اللاحقة لدى المتدرب يُرفض مع شرح', async () => {
  await withCommunity(async ({ user }) => {
    const fac = await user('هيا المُيسِّرة', 'fac@example.com');
    const tr = await user('خالد المتدرب', 'tr@example.com');
    const { seed, log } = goodRun(5);
    await tr('PUT', '/api/progress', { seed, log });
    // حالة حقيقية: خفض السعر لدى هذا المتدرب يغيّر حالة الشركة فلا يظهر لاحقًا حدث عشوائي ردّ عليه
    const d = (await fac('GET', '/api/facilitator/dialogues')).data.dialogues.find((x) => x.eventId === 'd6_competitor_price');
    const bad = await fac('POST', '/api/facilitator/review', { userId: d.userId, itemId: d.itemId, addressed: [], optionId: 'match_price' });
    assert.equal(bad.status, 422);
    assert.match(bad.data.error, /صحّح الاعتراضات فقط/);
    assert.equal((await fac('POST', '/api/facilitator/review', { userId: d.userId, itemId: d.itemId, addressed: ['margin'], optionId: d.ai.optionId })).status, 200, 'تصحيح الاعتراضات وحدها مقبول');
    assert.equal((await fac('POST', '/api/facilitator/review', { userId: d.userId, itemId: d.itemId, addressed: [], optionId: 'make_ceo' })).status, 400);
  });
});

test('معايرة: نسبة اتفاق الوكيل مع المُيسِّر، ومجموعة بيانات للمقارنة', async () => {
  await withCommunity(async ({ user }) => {
    const fac = await user('هيا المُيسِّرة', 'fac@example.com');
    const tr = await user('خالد المتدرب', 'tr@example.com');
    const { seed, log } = goodRun(9);
    await tr('PUT', '/api/progress', { seed, log });
    const list = (await fac('GET', '/api/facilitator/dialogues')).data.dialogues;
    const a = list.find((x) => x.eventId === 'd5_mgmt_meeting');
    const b = list.find((x) => x.eventId === 'd1_sales_request');
    await fac('POST', '/api/facilitator/review', { userId: a.userId, itemId: a.itemId, addressed: a.ai.addressed, optionId: a.ai.optionId });
    await fac('POST', '/api/facilitator/review', { userId: b.userId, itemId: b.itemId, addressed: [], optionId: b.ai.optionId });
    const cal = (await fac('GET', '/api/facilitator/calibration')).data;
    assert.equal(cal.reviewed, 2);
    assert.equal(cal.byAgentMode.claude.decisionAgreement, 100);
    assert.equal(cal.byAgentMode.claude.concernAgreement, 60, '3 من 3 + 0 من 2');
    assert.equal(cal.dataset.length, 2);
  });
});
