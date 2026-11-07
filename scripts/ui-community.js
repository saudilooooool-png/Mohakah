// فحص ميزات المجتمع في متصفح حقيقي: لوحة المُيسِّر، والجلسات الحية، ومراجعة الأقران.
// الاستخدام: MOHAKI_DATA_DIR=/tmp/x MOHAKI_FACILITATORS=fac@example.com npm start
//            ثم: MOHAKI_DATA_DIR=/tmp/x node scripts/ui-community.js [مجلد_لقطات]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goodRun } from './lib/runs.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173/app/';
const ORIGIN = new URL(BASE).origin;
const DATA = process.env.MOHAKI_DATA_DIR;
if (!DATA) { console.error('عيّن MOHAKI_DATA_DIR (نفس مجلد الخادم)'); process.exit(2); }
const shots = process.argv[2];
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };
const stamp = Date.now();

/** عميل API بملف تعريف ارتباط خاص به. */
function apiClient() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(ORIGIN + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  call.cookie = () => cookie;
  return call;
}
const lastLink = (to, kind) => {
  for (const f of readdirSync(join(DATA, 'outbox')).sort().reverse()) {
    const m = JSON.parse(readFileSync(join(DATA, 'outbox', f), 'utf8'));
    if (m.to === to && m.link?.includes(kind)) return m.link;
  }
  return null;
};
/** حساب مؤكد البريد عبر الواجهة البرمجية. */
async function account(name, email) {
  const call = apiClient();
  const r = await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
  await call('POST', '/api/auth/verify', { token: lastLink(email, 'confirm-email').split('/').pop() });
  call.id = r.data.id;
  call.email = email;
  return call;
}
/** صفحة متصفح مسجلة الدخول بحساب. */
async function pageFor(browser, call, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: 'mohaki_session', value: call.cookie().split('=')[1], url: ORIGIN }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return page;
}
const snap = async (page, n) => shots && page.screenshot({ path: `${shots}/com-${n}.png`, fullPage: true });

const browser = await chromium.launch();

// ——— 1) لوحة المُيسِّر ———
const facEmail = process.env.FAC_EMAIL || 'fac@example.com';
const fac = await account('هيا المُيسِّرة', facEmail);
const trainee = await account('خالد المتدرب', `trainee-${stamp}@example.com`);
const { seed, log } = goodRun(9);
await trainee('PUT', '/api/progress', { seed, log });
const before = (await trainee('POST', '/api/records/issue')).data;

const fp = await pageFor(browser, fac);
await fp.goto(`${BASE}#/facilitator`);
await fp.waitForSelector('.fac-row');
await fp.locator('.fac-row', { hasText: 'اجتماع الإدارة' }).first().click();
await fp.waitForSelector('form[data-form="fac-review"]');
for (const box of await fp.locator('form[data-form="fac-review"] input[name="addressed"]').all()) {
  if (await box.isChecked()) await box.uncheck();
}
await fp.locator('form[data-form="fac-review"] input[name="addressed"]').first().check();
await fp.locator('form[data-form="fac-review"] input[value="give_in"]').check();
await fp.fill('#fac-note', 'الرد عام: لم يجب المبيعات ولا التطوير برقم أو موعد.');
await snap(fp, '1-facilitator');
await fp.getByRole('button', { name: 'حفظ المراجعة' }).click();
await fp.waitForSelector('.kpi');
await fp.waitForTimeout(500);
check((await fp.locator('.kpi').first().textContent()).includes('اتفاق'), 'لم تظهر مؤشرات الاتفاق بعد المراجعة');
const after = (await trainee('POST', '/api/records/issue')).data;
check(after.points < before.points, `لم تتغير النقاط بعد التصحيح: ${before.points} ← ${after.points}`);

const tp = await pageFor(browser, trainee);
await tp.goto(`${BASE}#/inbox?f=closed`);
await tp.waitForSelector('.inbox-list');
await tp.locator('.inbox-list .item', { hasText: 'اجتماع الإدارة' }).first().click();
await tp.waitForSelector('.outcome');
check((await tp.locator('.detail').textContent()).includes('ملاحظة المُيسِّر'), 'المتدرب لا يرى ملاحظة المُيسِّر');
await snap(tp, '2-trainee-sees-review');
console.log(`✓ لوحة المُيسِّر (${before.points} ← ${after.points} نقطة)`);

// ——— 2) جلسة حية ———
const presenter = await account('سارة المقدّمة', `presenter-${stamp}@example.com`);
const player = await account('فهد لاعب الدور', `player-${stamp}@example.com`);
// المقدّمة تبدأ المحاكاة وتتقدم حتى يُفتح اجتماع الإدارة (اليوم 3)
const pp = await pageFor(browser, presenter);
await pp.goto(`${BASE}#/`);
const meetingsList = (await presenter('GET', '/api/live')).data; // للتأكد من الوصول
check(Array.isArray(meetingsList.sessions), 'قائمة الجلسات لا تعمل للمتدرب');

await fp.goto(`${BASE}#/live`);
await fp.waitForSelector('form[data-form="live-create"]');
const evId = await fp.locator('#lc-ev option', { hasText: 'اجتماع الإدارة' }).first().getAttribute('value');
await fp.selectOption('#lc-ev', evId);
await fp.fill('#lc-pr', presenter.email);
const roleInputs = fp.locator('form[data-form="live-create"] input[name^="role:"]');
await roleInputs.first().fill(player.email);
await fp.fill('#lc-at', '2026-11-08T10:00');
await snap(fp, '3-live-create');
await fp.getByRole('button', { name: 'إنشاء الجلسة' }).click();
await fp.waitForSelector('[data-live-msgs]');
await fp.getByRole('button', { name: 'بدء الجلسة' }).click();
await fp.waitForSelector('form[data-form="live-say"]');
const sessionId = (await fp.evaluate(() => location.hash)).split('/').pop();

const lp = await pageFor(browser, player, { width: 390, height: 844 });
await lp.goto(`${BASE}#/live/${sessionId}`);
await lp.waitForSelector('form[data-form="live-say"]');
check((await lp.locator('.card').last().textContent()).includes('أنت رئيس الاجتماع'), 'بطاقة الدور لا تظهر للاعب الدور');
await pp.goto(`${BASE}#/live/${sessionId}`);
await pp.waitForSelector('form[data-form="live-say"]');
await pp.fill('#live-msg', 'أقترح أن نبدأ بالتقارير لأن 40% من التذاكر عنها، ونعطي المبيعات موعدًا للتكامل في الربع القادم.');
await pp.getByRole('button', { name: 'إرسال', exact: true }).click();
await lp.waitForFunction(() => document.querySelector('[data-live-msgs]').textContent.includes('40%'), null, { timeout: 6000 });
await lp.fill('#live-msg', 'مقتنع بالموعد، بشرط أن نراجعه بعد أسبوعين.');
await lp.getByRole('button', { name: 'إرسال', exact: true }).click();
await snap(lp, '4-live-role-player');
await fp.waitForFunction(() => document.querySelector('[data-live-msgs]').textContent.includes('أسبوعين'), null, { timeout: 6000 });
const close = fp.locator('form[data-form="live-close"]');
await close.locator('input[name="addressed"]').first().check();
await close.locator('input[name="optionId"]').first().check();
await close.locator('select[name^="rating:"]').first().selectOption('5');
await fp.fill('form[data-form="live-close"] textarea[name="note"]', 'عرض واضح بأرقام.');
await snap(fp, '5-live-facilitator');
await fp.getByRole('button', { name: 'إنهاء الجلسة واعتماد الحكم' }).click();
await fp.waitForSelector('.outcome.good');
const results = (await presenter('GET', '/api/live-results')).data.results;
check(results?.[evId]?.optionId, 'لم تصل نتيجة الجلسة إلى المقدّمة');
const collab = (await player('GET', '/api/collaboration')).data;
check(collab.roles?.[0]?.rating === 5, `تقييم لاعب الدور لم يُسجل: ${JSON.stringify(collab)}`);
await pp.waitForSelector('.outcome.good', { timeout: 6000 });
await snap(pp, '6-live-presenter-result');
console.log('✓ الجلسة الحية (إنشاء، بدء، حوار مباشر، حكم، تقييم لاعب الدور)');

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('✓ ميزات المجتمع تعمل');
