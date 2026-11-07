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

// ——— 2) الجلسات الحية ———

async function liveSetup(user) {
  const fac = await user('هيا المُيسِّرة', 'fac@example.com');
  const presenter = await user('نورة المقدِّمة', 'presenter@example.com');
  const cfoPlayer = await user('سعد', 'cfo-player@example.com');
  const salesPlayer = await user('ريم', 'sales-player@example.com');
  const outsider = await user('غريب', 'outsider@example.com');
  const created = await fac('POST', '/api/live', {
    eventId: 'd5_mgmt_meeting', presenterEmail: 'presenter@example.com', scheduledAt: '2026-11-10T18:00',
    roles: { cfo: 'cfo-player@example.com', sales_head: 'sales-player@example.com' }, // التطوير والرئيس يؤديهما المُيسِّر
  });
  return { fac, presenter, cfoPlayer, salesPlayer, outsider, created, id: created.data.session?.id };
}

test('الجلسة الحية: المُيسِّر ينشئها ويسند الأدوار، ولكل لاعب بطاقة دوره', async () => {
  await withCommunity(async ({ user }) => {
    const { presenter, cfoPlayer, outsider, created, id, salesPlayer } = await liveSetup(user);
    assert.equal(created.status, 200);
    assert.equal((await salesPlayer('POST', '/api/live', { eventId: 'd5_mgmt_meeting', presenterEmail: 'presenter@example.com' })).status, 403, 'المتدرب لا ينشئ جلسات');
    const card = (await cfoPlayer('GET', `/api/live/${id}`)).data.session.card;
    assert.equal(card.speaker, 'cfo');
    assert.match(card.title, /هيفاء العتيبي/);
    assert.equal(card.concerns.length, 1);
    assert.match(card.concerns[0].convinceWhen, /مؤشر مالي/);
    assert.equal((await presenter('GET', `/api/live/${id}`)).data.session.card.kind, 'presenter');
    const roles = (await presenter('GET', `/api/live/${id}`)).data.session.roles;
    assert.equal(roles.find((r) => r.speaker === 'eng_lead').byFacilitator, true);
    assert.equal((await outsider('GET', `/api/live/${id}`)).status, 403);
    assert.ok((await cfoPlayer('GET', '/api/live')).data.sessions.some((s) => s.id === id && s.myRole === 'cfo'));
  });
});

test('الجلسة الحية: كل لاعب يتكلم بدوره فقط، والبداية تضع افتتاح الاجتماع', async () => {
  await withCommunity(async ({ user }) => {
    const { fac, presenter, cfoPlayer, id } = await liveSetup(user);
    await fac('POST', `/api/live/${id}/start`);
    let s = (await presenter('GET', `/api/live/${id}`)).data.session;
    assert.equal(s.status, 'live');
    assert.ok(s.messages.length >= 4, 'افتتاح الاجتماع من السيناريو');
    await cfoPlayer('POST', `/api/live/${id}/message`, { as: 'ceo', text: 'أنا الرئيس التنفيذي!' });
    await presenter('POST', `/api/live/${id}/message`, { text: 'نوصي بإصلاح التقارير ونقيس الأثر بعد أسبوعين.' });
    await fac('POST', `/api/live/${id}/message`, { as: 'eng_lead', text: 'والجدول؟' });
    s = (await presenter('GET', `/api/live/${id}`)).data.session;
    const last = s.messages.slice(-3).map((m) => m.as);
    assert.deepEqual(last, ['cfo', 'trainee', 'eng_lead'], 'لاعب المالية لا يتكلم بلسان الرئيس');
  });
});

test('ختام الجلسة: حكم المُيسِّر يصبح نتيجة اجتماع المقدّم، ولا يمكن تعديله من المتصفح', async () => {
  await withCommunity(async ({ user }) => {
    const { fac, presenter, cfoPlayer, salesPlayer, id } = await liveSetup(user);
    await fac('POST', `/api/live/${id}/start`);
    await presenter('POST', `/api/live/${id}/message`, { text: 'رد المقدّم' });
    const closed = await fac('POST', `/api/live/${id}/close`, {
      addressed: ['roi', 'timeline'], optionId: 'defend_with_data', note: 'دفاع جيد بالأرقام',
      ratings: { [cfoPlayer.id]: 5, [salesPlayer.id]: 3, notAPlayer: 5 },
    });
    assert.equal(closed.status, 200);
    const results = (await presenter('GET', '/api/live-results')).data.results;
    assert.deepEqual(results.d5_mgmt_meeting.addressed, ['roi', 'timeline']);
    assert.ok(results.d5_mgmt_meeting.transcript.some((l) => l.speaker === 'trainee'));
    // المقدّم يعتمد النتيجة في محاكاته
    const { seed, log } = goodRun(9);
    const human = log.map((a) => (a.t === 'respond' && a.itemId.startsWith('d5_mgmt_meeting#')
      ? { ...a, optionId: 'defend_with_data', addressed: ['roi', 'timeline'], transcript: results.d5_mgmt_meeting.transcript, mode: 'human' } : a));
    await presenter('PUT', '/api/progress', { seed, log: human });
    assert.equal((await presenter('POST', '/api/records/issue')).status, 200);
    // التلاعب: رفع الاعتراضات المجابة في المتصفح
    const forged = human.map((a) => (a.mode === 'human' ? { ...a, addressed: ['roi', 'timeline', 'customers'] } : a));
    await presenter('PUT', '/api/progress', { seed, log: forged });
    assert.equal((await presenter('POST', '/api/records/issue')).status, 422);
    // تقييم لاعبي الأدوار جدارة تعاون مستقلة
    const collab = (await cfoPlayer('GET', '/api/collaboration')).data;
    assert.equal(collab.roles[0].rating, 5);
    assert.equal((await fac('POST', `/api/live/${id}/message`, { text: 'بعد الختام' })).status, 400);
  });
});

// ——— 3) مراجعة الأقران ———

const peerBody = (a, extra = {}) => ({
  assignmentId: a.id,
  sections: Object.fromEntries(a.sections.map((s, i) => [s.id, i % 2 ? 'partly' : 'yes'])),
  strengths: 'التوصية واضحة ومربوطة برقم.',
  improve: 'ينقص المستند مؤشر نجاح محدد بموعد، مثل نسبة الاستخدام بعد شهر.',
  overall: 4,
  ...extra,
});

test('مراجعة الأقران: لا يُعرض إلا مستند من وافق، بلا اسم الكاتب، ولا يراجع أحد مستنده', async () => {
  await withCommunity(async ({ user }) => {
    const author = await user('كاتب', 'author@example.com');
    const other = await user('غير موافق', 'nope@example.com');
    const reviewer = await user('مراجع', 'rev@example.com');
    const { seed, log } = goodRun(9, { stopDay: 2 });
    await author('PUT', '/api/progress', { seed, log });
    await other('PUT', '/api/progress', { seed, log });
    // قبل الموافقة: لا شيء
    assert.equal((await reviewer('GET', '/api/peer/queue')).data.assignments.length, 0);
    await author('PATCH', '/api/me', { consents: { peerReview: true } });
    const q = (await reviewer('GET', '/api/peer/queue')).data.assignments;
    assert.equal(q.length, 2); // تكليفان مفتوحان كحد أقصى
    assert.ok(q[0].text.length > 50 && q[0].sections.length >= 4);
    assert.ok(!JSON.stringify(q).includes('كاتب') && !JSON.stringify(q).includes('author@'), 'يظهر اسم الكاتب للمراجع');
    // الكاتب لا يُكلَّف بمستنده
    assert.equal((await author('GET', '/api/peer/queue')).data.assignments.length, 0);
    // الطلب نفسه يعيد التكليفات نفسها
    assert.deepEqual((await reviewer('GET', '/api/peer/queue')).data.assignments.map((a) => a.id), q.map((a) => a.id));
  });
});

test('مراجعة الأقران: تحقق المحتوى، ومراجعتان كحد أقصى للمستند، والكاتب يقيّم فائدتها', async () => {
  await withCommunity(async ({ user, store }) => {
    const author = await user('كاتب', 'author@example.com');
    await author('PATCH', '/api/me', { consents: { peerReview: true } });
    const { seed, log } = goodRun(9, { stopDay: 1 });
    await author('PUT', '/api/progress', { seed, log });
    const docs = log.filter((a) => a.t === 'deliver').length;
    const [r1, r2, r3] = [await user('مراجع أول', 'r1@example.com'), await user('مراجع ثان', 'r2@example.com'), await user('مراجع ثالث', 'r3@example.com')];
    const a1 = (await r1('GET', '/api/peer/queue')).data.assignments[0];
    assert.equal((await r1('POST', '/api/peer/review', peerBody(a1, { improve: 'جيد' }))).status, 400);
    assert.equal((await r1('POST', '/api/peer/review', peerBody(a1, { sections: {} }))).status, 400);
    assert.equal((await r2('POST', '/api/peer/review', peerBody(a1))).status, 404, 'مراجع يرسل على تكليف غيره');
    assert.equal((await r1('POST', '/api/peer/review', peerBody(a1))).status, 200);
    assert.equal((await r1('POST', '/api/peer/review', peerBody(a1))).status, 409);
    await r2('GET', '/api/peer/queue');
    // بعد مراجعين اثنين لكل مستند، لا يبقى للثالث شيء
    assert.equal(docs, 2);
    assert.equal(Object.keys(store.community.peer.assignments).length, 4);
    assert.equal((await r3('GET', '/api/peer/queue')).data.assignments.length, 0);
    const got = (await author('GET', '/api/peer/received')).data.reviews;
    assert.equal(got.length, 1);
    assert.equal(got[0].sections.length, a1.sections.length);
    assert.ok(!JSON.stringify(got).includes('مراجع أول'), 'يظهر اسم المراجع للكاتب');
    assert.equal((await r1('POST', '/api/peer/feedback', { reviewId: got[0].id, helpful: true })).status, 404, 'غير الكاتب يقيّم الفائدة');
    await author('POST', '/api/peer/feedback', { reviewId: got[0].id, helpful: true });
    const c = (await r1('GET', '/api/collaboration')).data.summary;
    assert.deepEqual([c.reviewsGiven, c.reviewsHelpful], [1, 1]);
  });
});

test('مراجعة الأقران: المُيسِّر يرى الأسماء ويخفي المراجعة المسيئة، ولا تؤثر على النقاط', async () => {
  await withCommunity(async ({ user }) => {
    const fac = await user('مُيسِّرة', 'fac@example.com');
    const author = await user('كاتب', 'author@example.com');
    const r1 = await user('مراجع', 'r1@example.com');
    await author('PATCH', '/api/me', { consents: { peerReview: true } });
    const { seed, log } = goodRun(9);
    await author('PUT', '/api/progress', { seed, log });
    const before = (await author('POST', '/api/records/issue')).data;
    const a = (await r1('GET', '/api/peer/queue')).data.assignments[0];
    await r1('POST', '/api/peer/review', peerBody(a, { overall: 1 }));
    const [rev] = (await author('GET', '/api/peer/received')).data.reviews;
    await author('POST', '/api/peer/feedback', { reviewId: rev.id, helpful: false, report: true });
    assert.equal((await r1('GET', '/api/facilitator/peer')).status, 403);
    const list = (await fac('GET', '/api/facilitator/peer')).data.reviews;
    assert.equal(list[0].reported, true);
    assert.deepEqual([list[0].reviewer, list[0].author], ['مراجع', 'كاتب']);
    await fac('POST', '/api/facilitator/peer/moderate', { reviewId: rev.id, hidden: true, reason: 'تعليق غير مهني' });
    assert.equal((await author('GET', '/api/peer/received')).data.reviews.length, 0);
    assert.equal((await r1('GET', '/api/collaboration')).data.summary.reviewsGiven, 0, 'المراجعة المخفية لا تُحسب');
    // نقاط الكاتب لم تتغير بتقييم 1 من 5
    const after = (await author('POST', '/api/records/issue')).data;
    assert.equal(after.points, before.points);
    assert.equal(after.code, before.code);
  });
});

test('حذف الحساب يزيل مراجعات الأقران وتكليفاتها', async () => {
  await withCommunity(async ({ user, store }) => {
    const author = await user('كاتب', 'author@example.com');
    const r1 = await user('مراجع', 'r1@example.com');
    await author('PATCH', '/api/me', { consents: { peerReview: true } });
    const { seed, log } = goodRun(9, { stopDay: 1 });
    await author('PUT', '/api/progress', { seed, log });
    const a = (await r1('GET', '/api/peer/queue')).data.assignments[0];
    await r1('POST', '/api/peer/review', peerBody(a));
    await author('DELETE', '/api/me');
    assert.equal(Object.keys(store.community.peer.reviews).length, 0);
    assert.equal(Object.keys(store.community.peer.assignments).length, 0);
  });
});
