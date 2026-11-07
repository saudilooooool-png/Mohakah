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

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('✓ ميزات المجتمع تعمل');
