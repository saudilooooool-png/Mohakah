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

// ——— ملف الأعمال الموثّق ———

test('ملف الأعمال: المرشحون من إعادة التشغيل، والاختيار يُقيَّد بما في السجل وبالحدود', async () => {
  await withServer(async ({ user }) => {
    const me = await user('نورة العتيبي', 'noura@example.com');
    assert.equal((await me('GET', '/api/portfolio/me')).status, 400);
    await me('PUT', '/api/progress', goodRun(9));
    const ed = (await me('GET', '/api/portfolio/me')).data;
    assert.equal(ed.portfolio, null);
    assert.equal(ed.candidates.deliverables.length, 4);
    assert.ok(ed.candidates.decisions.length >= 17);
    assert.ok(!('text' in ed.candidates.deliverables[0]), 'المحرر يكفيه مقتطف');
    const docs = ed.candidates.deliverables.map((d) => d.id);
    const decs = ed.candidates.decisions.map((d) => d.id);
    const saved = (await me('PUT', '/api/portfolio/me', {
      headline: 'مدير منتجات يحب البيانات', displayName: 'first', published: true,
      selections: { deliverables: [...docs, 'fake'], decisions: decs, quotes: [] },
    })).data;
    assert.equal(saved.portfolio.selections.deliverables.length, 3, 'حد المستندات');
    assert.equal(saved.portfolio.selections.decisions.length, 5, 'حد القرارات');
    assert.ok(!saved.portfolio.selections.deliverables.includes('fake'));
    assert.match(saved.portfolio.slug, /^[A-Z2-9]{8}$/);
  });
});

test('ملف الأعمال العام: محتوى موثّق بالاسم المختار، ويتوقف عند الإلغاء أو بدء شهر جديد', async () => {
  await withServer(async ({ user }) => {
    const me = await user('نورة العتيبي', 'noura@example.com');
    await me('PUT', '/api/progress', goodRun(9));
    const ed = (await me('GET', '/api/portfolio/me')).data;
    const { slug } = (await me('PUT', '/api/portfolio/me', {
      headline: 'أبني منتجات بالأرقام', displayName: 'first', published: false,
      selections: { deliverables: [ed.candidates.deliverables[0].id], decisions: [ed.candidates.decisions[0].id], quotes: [] },
    })).data.portfolio;
    const guest = await user();
    assert.equal((await guest('GET', `/api/portfolio/${slug}`)).status, 404, 'غير المنشور لا يظهر');
    await me('PUT', '/api/portfolio/me', { ...ed.portfolio, headline: 'أبني منتجات بالأرقام', published: true, selections: { deliverables: [ed.candidates.deliverables[0].id], decisions: [ed.candidates.decisions[0].id], quotes: [] } });
    const p = (await guest('GET', `/api/portfolio/${slug}`)).data.portfolio;
    assert.equal(p.name, 'نورة');
    assert.ok(p.points > 700 && p.finished);
    assert.equal(typeof p.band, 'string');
    assert.equal(p.deliverables.length, 1);
    assert.ok(p.deliverables[0].text.length > 100, 'المستند كاملًا من السجل');
    assert.equal(p.series.you.length, p.series.baseline.length);
    assert.ok(p.impact.mrr > p.impact.mrrBaseline);
    assert.ok(!JSON.stringify(p).includes('noura@'));
    const page = (await guest('GET', `/p/${slug}`)).data;
    assert.ok(page.includes('og:title') && page.includes('نورة'));
    // شهر جديد: الملف لا يعرض أعمالًا لم تعد في السجل
    await me('PUT', '/api/progress', goodRun(5, { stopDay: 1 }));
    assert.equal((await guest('GET', `/api/portfolio/${slug}`)).status, 404);
    await me('PUT', '/api/progress', goodRun(9));
    assert.equal((await guest('GET', `/api/portfolio/${slug}`)).status, 200);
    await me('DELETE', '/api/portfolio/me');
    assert.equal((await guest('GET', `/api/portfolio/${slug}`)).status, 404);
  });
});

test('حذف الحساب يوقف روابط التحدي وملف الأعمال', async () => {
  await withServer(async ({ user }) => {
    const me = await user('نورة العتيبي', 'noura@example.com');
    await me('PUT', '/api/progress', goodRun(9));
    const { code } = (await me('POST', '/api/challenges')).data.challenge;
    const { slug } = (await me('PUT', '/api/portfolio/me', { published: true, selections: {} })).data.portfolio;
    await me('DELETE', '/api/me');
    const guest = await user();
    assert.equal((await guest('GET', `/api/challenges/${code}`)).status, 404);
    assert.equal((await guest('GET', `/api/portfolio/${slug}`)).status, 404);
  });
});

test('شهر دور آخر: الخادم يعيد التشغيل بسيناريو الدور، والسجل يحمل الدور، والتحدي يبقى على الدور نفسه', async () => {
  await withServer(async ({ user }) => {
    const me = await user('سارة العتيبي', 'sara@example.com');
    await me('PUT', '/api/progress', goodRun(9, { scenario: 'sales-month' }));
    assert.equal((await me('GET', '/api/progress')).data.progress.scenario, 'sales-month');
    const c = (await me('POST', '/api/challenges')).data.challenge;
    assert.deepEqual([c.scenario, c.owner.finished], ['sales-month', true]);
    assert.ok(c.role.includes('Sales'));
    const friend = await user('خالد', 'khalid@example.com');
    await friend('PUT', '/api/progress', { ...goodRun(9, { stopDay: 2 }), challenge: c.code }); // شهر المنتجات بالبذرة نفسها: ليس التحدي نفسه
    assert.equal((await friend('GET', `/api/challenges/${c.code}`)).data.challenge.participants, 0);
    await friend('PUT', '/api/progress', { ...goodRun(9, { stopDay: 2, scenario: 'sales-month' }), challenge: c.code });
    assert.equal((await friend('GET', `/api/challenges/${c.code}`)).data.challenge.participants, 1);
    // سيناريو غير معروف يُتجاهل
    await friend('PUT', '/api/progress', { ...goodRun(9, { stopDay: 1 }), scenario: 'hack' });
    assert.equal((await friend('GET', '/api/progress')).data.progress.scenario, undefined);
  });
});

test('السجل الموثّق يحمل تقييم فترة التجربة: قرار التثبيت والأهداف والجدارات', async () => {
  await withServer(async ({ user, store }) => {
    const me = await user('سارة العتيبي', 'sara@example.com');
    const u = Object.values(store.users)[0]; u.emailVerifiedAt = new Date().toISOString();
    await me('PUT', '/api/progress', goodRun(9));
    const rec = (await me('POST', '/api/records/issue')).data;
    assert.equal(rec.appraisal.role.id, 'pm');
    assert.equal(rec.appraisal.total, 5);
    assert.ok(['confirmed', 'extended'].includes(rec.appraisal.decision.id));
    assert.equal(rec.appraisal.competencies.length, 7);
  });
});
