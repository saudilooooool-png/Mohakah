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
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-t-'));
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

test('الزميل الحقيقي: الطلب يقرن أول اثنين ينتظران، والمحادثة محفوظة للطرفين فقط', async () => {
  await withServer(async ({ user }) => {
    const a = await user('سارة العتيبي', 'a@example.com');
    const b = await user('خالد الحربي', 'b@example.com');
    const c = await user('منى السبيعي', 'c@example.com');
    assert.equal((await a('POST', '/api/pairs/request')).data.waiting, true);
    const pb = (await b('POST', '/api/pairs/request')).data.pair;
    assert.equal(pb.partner, 'سارة');
    assert.ok(!JSON.stringify(pb).includes('العتيبي'), 'الاسم الأول فقط');
    await b('POST', `/api/pairs/${pb.id}/message`, { text: 'كيف رتبت أولويات اليوم الثالث؟' });
    const pa = (await a('GET', '/api/pairs/mine')).data.pairs[0];
    assert.equal(pa.messages.length, 1);
    assert.equal(pa.messages[0].mine, false);
    assert.equal((await c('POST', `/api/pairs/${pb.id}/message`, { text: 'تطفل' })).status, 404, 'غير الطرفين لا يكتب');
    assert.equal((await c('GET', '/api/pairs/mine')).data.pairs.length, 0);
  });
});

test('محادثات تحسين النماذج: فقط حين يوافق الطرفان، ودون أسماء، وبرمز المسؤول', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const a = await user('سارة العتيبي', 'a@example.com');
    const b = await user('خالد الحربي', 'b@example.com');
    const { pair } = (await fac('POST', '/api/facilitator/pairs', { emails: ['a@example.com', 'b@example.com'], days: 3 })).data;
    await a('POST', `/api/pairs/${pair.id}/message`, { text: 'مرحبًا' });
    const adm = (await user())('GET', '/api/admin/training-chats', null, { Authorization: 'Bearer adm' });
    assert.equal((await adm).data.chats.length, 0, 'دون موافقة لا شيء');
    await a('PATCH', '/api/me', { consents: { aiTraining: true } });
    assert.equal((await (await user())('GET', '/api/admin/training-chats', null, { Authorization: 'Bearer adm' })).data.chats.length, 0, 'موافقة طرف واحد لا تكفي');
    await b('PATCH', '/api/me', { consents: { aiTraining: true } });
    const chats = (await (await user())('GET', '/api/admin/training-chats', null, { Authorization: 'Bearer adm' })).data.chats;
    assert.equal(chats.length, 1);
    assert.deepEqual(chats[0].messages, [{ speaker: 'A', text: 'مرحبًا' }]);
    assert.equal((await (await user())('GET', '/api/admin/training-chats')).status, 401);
  });
});

test('دوري الفرق: العالم نفسه لكل الفرق، والنتيجة متوسط الأعضاء حتى يوم الجولة، والترتيب العام', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const [a1, a2, b1] = [await user('سارة العتيبي', 'a1@example.com'), await user('ريم القحطاني', 'a2@example.com'), await user('خالد الحربي', 'b1@example.com')];
    assert.equal((await a1('POST', '/api/leagues', { name: 'دوري', teams: [] })).status, 403);
    const league = (await fac('POST', '/api/leagues', {
      name: 'دوري جامعة الملك سعود',
      teams: [{ name: 'الصقور', emails: ['a1@example.com', 'a2@example.com'] }, { name: 'النجوم', emails: ['b1@example.com'] }],
      rounds: [{ title: 'الأسبوع الأول', untilDay: 3, deadline: '2099-01-01T00:00:00Z' }],
    })).data.league;
    assert.ok(league.seed > 0);
    const run = (stopDay) => ({ ...goodRun(league.seed, { stopDay }), league: league.id });
    await a1('PUT', '/api/progress', run(4));
    await a2('PUT', '/api/progress', run(2)); // لم يصل إلى يوم الجولة بعد
    await b1('PUT', '/api/progress', { ...goodRun(7, { stopDay: 4 }), league: league.id }); // بذرة أخرى: لا يُحتسب
    const v = (await a1('GET', `/api/leagues/${league.id}`)).data.league;
    assert.equal(v.joined, true);
    assert.equal(v.myTeam.name, 'الصقور');
    const s = v.rounds[0].standings;
    const falcons = s.find((x) => x.name === 'الصقور');
    assert.equal(falcons.finished, 1);
    assert.ok(falcons.score > 0);
    assert.equal(s.find((x) => x.name === 'النجوم').score, null);
    assert.equal(v.overall[0].name, 'الصقور');
    const outsider = await user('منى', 'm@example.com');
    assert.equal((await outsider('GET', `/api/leagues/${league.id}`)).status, 403);
  });
});

test('الجولة المنتهية موعدها تُجمَّد نتائجها', async () => {
  await withServer(async ({ user, store }) => {
    const fac = await user('هيا', 'fac@example.com');
    const a = await user('سارة العتيبي', 'a@example.com');
    await user('خالد الحربي', 'b@example.com');
    const league = (await fac('POST', '/api/leagues', { name: 'دوري سريع', teams: [{ name: 'أ', emails: ['a@example.com'] }, { name: 'ب', emails: ['b@example.com'] }], rounds: [{ untilDay: 2, deadline: '2000-01-01T00:00:00Z' }] })).data.league;
    const first = (await a('GET', `/api/leagues/${league.id}`)).data.league.rounds[0];
    assert.equal(first.closed, true);
    await a('PUT', '/api/progress', { ...goodRun(league.seed, { stopDay: 3 }), league: league.id });
    const after = (await a('GET', `/api/leagues/${league.id}`)).data.league.rounds[0];
    assert.deepEqual(after.standings, first.standings, 'لا تتغير بعد الإغلاق');
    assert.ok(store.teams.leagues[league.id].rounds[0].results);
  });
});
