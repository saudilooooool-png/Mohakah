// فحص حساب الجهة: المُيسِّر ينشئ الجهة، ومديرها ينشئ دفعة، والمتدرب ينضم بالرمز، واللوحة تعرض تقدمه.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goodRun } from '../lib/runs.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const O = 'http://localhost:4173';
const SH = process.env.SHOTS || '/tmp';
const D = process.env.MOHAKI_DATA_DIR;
const client = () => { let cookie = ''; const call = async (m, p, b) => { const r = await fetch(O + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return r.json().catch(() => ({})); }; call.cookie = () => cookie.split('=')[1]; return call; };
const verify = async (call, email) => {
  const f = readdirSync(join(D, 'outbox')).map((n) => JSON.parse(readFileSync(join(D, 'outbox', n), 'utf8'))).reverse().find((m) => m.to === email && m.link?.includes('confirm-email'));
  await call('POST', '/api/auth/verify', { token: f.link.split('/').pop() });
};
const t = Date.now();
const mgrMail = `mgr-${t}@academy.sa`;
const fac = client(); await fac('POST', '/api/auth/login', { email: 'fac@example.com', password: 'secret-123' });
if (!(await fac('GET', '/api/orgs')).facilitator) { await fac('POST', '/api/auth/register', { name: 'هيا المُيسِّرة', email: 'fac@example.com', password: 'secret-123', consents: { processing: true } }); await verify(fac, 'fac@example.com'); }
const mgr = client(); await mgr('POST', '/api/auth/register', { name: 'مدير الأكاديمية', email: mgrMail, password: 'secret-123', consents: { processing: true } }); await verify(mgr, mgrMail);
const tr = client(); await tr('POST', '/api/auth/register', { name: 'سارة العتيبي', email: `org-${t}@x.sa`, password: 'secret-123', consents: { processing: true } });
await tr('PUT', '/api/progress', goodRun(9, { scenario: 'cs-month' }));
const errs = [];
const b = await chromium.launch();
const page = async (call, w = 1280) => { const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); await ctx.addCookies([{ name: 'mohaki_session', value: call.cookie(), url: O }]); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); return p; };
// المُيسِّر ينشئ الجهة
let p = await page(fac);
await p.goto(`${O}/app/#/org`);
await p.waitForSelector('form[data-form="org-new"]');
await p.fill('form[data-form="org-new"] [name=name]', `أكاديمية التقنية ${t}`);
await p.fill('form[data-form="org-new"] [name=managers]', mgrMail);
await p.click('form[data-form="org-new"] button[type=submit]');
await p.waitForSelector('form[data-form="org-cohort"]');
// مدير الجهة ينشئ دفعة
p = await page(mgr);
await p.goto(`${O}/app/#/org`);
await p.waitForSelector('form[data-form="org-cohort"]');
if (await p.locator('form[data-form="org-new"]').count()) errs.push('manager sees create-org');
await p.fill('form[data-form="org-cohort"] [name=name]', 'معسكر نوفمبر');
await p.click('form[data-form="org-cohort"] button[type=submit]');
await p.waitForSelector('.cohort');
const code = (await p.locator('.cohort .office-h b').first().textContent()).trim();
// المتدرب ينضم بالرمز
const q = await page(tr, 390);
await q.goto(`${O}/app/#/org`);
await q.waitForSelector('form[data-form="org-join"]');
await q.fill('#org-code', code);
await q.check('form[data-form="org-join"] [name=consent]');
await q.click('form[data-form="org-join"] button[type=submit]');
await q.waitForSelector('[data-act="org-leave"]');
if (await q.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errs.push('mobile h-scroll');
await q.screenshot({ path: `${SH}/org-trainee.png`, fullPage: true });
// اللوحة تعرض تقدمه
await p.reload();
await p.waitForSelector('.cohort table tbody tr');
const row = await p.locator('.cohort table tbody tr').first().textContent();
if (!row.includes('سارة العتيبي') || !row.includes('30/30')) errs.push('row: ' + row);
const csv = await (await fetch(`${O}${await p.locator('.cohort a[download]').first().getAttribute('href')}`, { headers: { cookie: `mohaki_session=${mgr.cookie()}` } })).text();
if (!csv.includes('سارة العتيبي') || !csv.includes('معسكر نوفمبر')) errs.push('csv');
await p.screenshot({ path: `${SH}/org.png`, fullPage: true });
await b.close();
console.log(errs.length ? errs.join('\n') : 'ok');
