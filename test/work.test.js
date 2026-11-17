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
  const dir = mkdtempSync(join(tmpdir(), 'mohaki-w-'));
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

const gig = (extra = {}) => ({
  title: 'اختبار تجربة الاستخدام لموقع حجز', org: 'جهة تجريبية', kind: 'ux',
  description: 'اختبر رحلة الحجز على الجوال واكتب أهم 5 مشكلات.', deliverable: 'تقرير قصير بالمشكلات مرتبة بالأولوية، مع لقطات.',
  link: 'https://example.org/booking', points: 80, slots: 1, minDays: 5, reviewerEmail: 'org@example.com', amount: 300, ...extra,
});

test('الأعمال الواقعية: تُفتح بعد التقدم في المحاكاة، والرابط للمكلَّف فقط', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const t = await user('سارة العتيبي', 't@example.com');
    assert.equal((await t('POST', '/api/work', gig())).status, 403, 'المتدرب لا ينشر فرصًا');
    const { gig: g } = (await fac('POST', '/api/work', gig())).data;
    let list = (await t('GET', '/api/work')).data;
    assert.ok(list.gigs[0].locked.includes('5'), 'مقفلة قبل 5 أيام');
    assert.equal(list.gigs[0].link, null);
    assert.equal((await t('POST', `/api/work/${g.id}/apply`, {})).status, 403);
    await t('PUT', '/api/progress', goodRun(9, { stopDay: 5 }));
    list = (await t('GET', '/api/work')).data;
    assert.equal(list.gigs[0].locked, null);
    assert.equal(list.readiness.days, 5);
    assert.ok(!JSON.stringify(list).includes('org@example.com'), 'بريد المراجع لا يظهر للمتدرب');
    const app = (await t('POST', `/api/work/${g.id}/apply`, { note: 'أعمل على تجربة المستخدم في محاكي.' })).data.application;
    assert.equal(app.status, 'pending');
    assert.equal((await t('POST', `/api/work/${g.id}/apply`, {})).status, 409);
  });
});

test('دورة العمل: قبول، تسليم، طلب تعديل، اعتماد بتقييم، ونقاط منفصلة، وحالة الدفع', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const org = await user('ممثل الجهة', 'org@example.com');
    const t = await user('سارة العتيبي', 't@example.com');
    const other = await user('خالد', 'o@example.com');
    const { gig: g } = (await fac('POST', '/api/work', gig({ minDays: 0 }))).data;
    const app = (await t('POST', `/api/work/${g.id}/apply`, {})).data.application;
    assert.equal((await other('POST', `/api/work/apps/${app.id}/decide`, { action: 'accept' })).status, 404, 'غير المراجع لا يقرر');
    await org('POST', `/api/work/apps/${app.id}/decide`, { action: 'accept' });
    assert.equal((await other('POST', `/api/work/${g.id}/apply`, {})).status, 409, 'اكتمل المقعد الوحيد');
    const mine = (await t('GET', '/api/work')).data.gigs[0];
    assert.equal(mine.link, 'https://example.org/booking', 'الرابط بعد القبول');
    assert.equal((await t('POST', `/api/work/apps/${app.id}/submit`, { text: 'قصير' })).status, 400);
    await t('POST', `/api/work/apps/${app.id}/submit`, { text: 'وجدت 5 مشكلات: زر الدفع مخفي على الجوال، وحقل التاريخ لا يقبل الهجري...', link: 'https://docs.example/report' });
    const q = (await org('GET', '/api/work/review')).data.applications;
    assert.equal(q[0].status, 'submitted');
    assert.equal(q[0].trainee.name, 'سارة العتيبي', 'المراجع يرى اسم المتدرب');
    await org('POST', `/api/work/apps/${app.id}/decide`, { action: 'revise', feedback: 'رتّب المشكلات بالأولوية' });
    await t('POST', `/api/work/apps/${app.id}/submit`, { text: 'مرتبة بالأولوية: 1) زر الدفع مخفي على الجوال 2) حقل التاريخ ...' });
    assert.equal((await org('POST', `/api/work/apps/${app.id}/decide`, { action: 'approve' })).status, 400, 'الاعتماد يحتاج تقييمًا');
    await org('POST', `/api/work/apps/${app.id}/decide`, { action: 'approve', rating: 4, feedback: 'عمل ممتاز' });
    const s = (await t('GET', '/api/work/summary')).data;
    assert.deepEqual([s.count, s.points], [1, 64]);
    assert.equal((await t('GET', '/api/work')).data.gigs[0].mine.payout, 'due');
    await fac('POST', `/api/work/apps/${app.id}/decide`, { action: 'paid' });
    assert.equal((await t('GET', '/api/work')).data.gigs[0].mine.payout, 'paid');
  });
});

test('الأعمال المعتمدة تظهر في السجل الموثّق دون أن تغيّر نقاط المحاكاة', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const t = await user('سارة العتيبي', 't@example.com');
    await t('PUT', '/api/progress', goodRun(9));
    const before = (await t('POST', '/api/records/issue')).data;
    const { gig: g } = (await fac('POST', '/api/work', gig({ minDays: 10, amount: 0 }))).data;
    const app = (await t('POST', `/api/work/${g.id}/apply`, {})).data.application;
    await fac('POST', `/api/work/apps/${app.id}/decide`, { action: 'accept' });
    await t('POST', `/api/work/apps/${app.id}/submit`, { text: 'أنجزت الاختبار وكتبت التقرير بالمشكلات الخمس مرتبة بالأولوية.' });
    await fac('POST', `/api/work/apps/${app.id}/decide`, { action: 'approve', rating: 5 });
    assert.equal((await t('GET', '/api/work')).data.gigs[0].mine.payout, null, 'غير مدفوعة');
    const rec = (await t('POST', '/api/records/issue')).data;
    assert.equal(rec.points, before.points, 'نقاط المحاكاة كما هي');
    assert.equal(rec.realWork.count, 1);
    assert.equal(rec.realWork.items[0].org, 'جهة تجريبية');
  });
});

test('مشروع داخلي لمحاكي: نوع بيع خدماتنا، بلا أجر وبعمولة اختيارية، والتسليم مسودة يعتمدها المشرف', async () => {
  await withServer(async ({ user }) => {
    const fac = await user('هيا', 'fac@example.com');
    const t = await user('سارة العتيبي', 't@example.com');
    const { gig: g } = (await fac('POST', '/api/work', { title: 'التواصل مع 10 جامعات لعرض محاكي', org: 'محاكي', kind: 'sales', internal: true, commissionType: 'percent', commissionValue: 10, commissionCap: 2000, description: 'جهّز رسالة تعريفية وقائمة الجهات.', minDays: 0, amount: 0 })).data;
    const list = (await t('GET', '/api/work')).data.gigs[0];
    assert.deepEqual([list.internal, list.commission.type, list.commission.value, list.paid, list.kindLabel], [true, 'percent', 10, null, 'التواصل مع الجهات لبيع خدماتنا']);
    const app = (await t('POST', `/api/work/${g.id}/apply`, {})).data.application;
    await fac('POST', `/api/work/apps/${app.id}/decide`, { action: 'accept' });
    await t('POST', `/api/work/apps/${app.id}/submit`, { text: 'مسودة الرسالة: السلام عليكم، نقدم في محاكي محاكاة عمل لطلابكم... وقائمة 10 جامعات.' });
    const q = (await fac('GET', '/api/work/review')).data.applications[0];
    assert.equal(q.status, 'submitted', 'لا يخرج شيء قبل اعتماد المشرف');
    assert.equal(q.gig.internal, true);
    // العمولة متغيرة: نسبة من قيمة الصفقة التي يدخلها المشرف عند الاعتماد، بحد أقصى
    await fac('POST', `/api/work/apps/${app.id}/decide`, { action: 'approve', rating: 5, dealValue: 12000 });
    let mine = (await t('GET', '/api/work')).data.gigs[0].mine;
    assert.deepEqual([mine.commission.amount, mine.payout], [1200, 'due']);
    await fac('POST', `/api/work/apps/${app.id}/decide`, { action: 'paid' });
    mine = (await t('GET', '/api/work')).data.gigs[0].mine;
    assert.equal(mine.payout, 'paid');
  });
});

test('صفحة المتدرب: العمر والسيرة وأرقام التواصل اختيارية وتُنظَّف، ولا تصل لجهات التوظيف دون موافقة', async () => {
  await withServer(async ({ user }) => {
    const t = await user('سارة العتيبي', 't@example.com');
    const me = (await t('PATCH', '/api/me', { profile: { birthYear: 2002, phone: '+966501234567', phone2: 'abc', linkedin: 'http://evil.example', cvUrl: 'https://drive.example/cv.pdf', summary: 'خريجة نظم معلومات', skills: 'إكسل' } })).data;
    assert.deepEqual([me.profile.birthYear, me.profile.phone, me.profile.phone2, me.profile.linkedin, me.profile.cvUrl], [2002, '+966501234567', '', '', 'https://drive.example/cv.pdf']);
    assert.equal(me.consents.employerSharing, false);
  });
});
