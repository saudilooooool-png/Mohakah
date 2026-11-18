// فحص جلسة التقييم للشركات في المتصفح: المُيسِّر ينشئ، والمرشح يعمل بلا حساب، والشركة تفتح التقرير.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const O = 'http://localhost:4173'; const DATA = process.env.MOHAKI_DATA_DIR;
const SH = process.env.SHOTS || '/tmp';
const link = (to) => { for (const f of readdirSync(join(DATA, 'outbox')).sort().reverse()) { const m = JSON.parse(readFileSync(join(DATA, 'outbox', f), 'utf8')); if (m.to === to && m.link?.includes('confirm-email')) return m.link; } };
let cookie = '';
const call = async (m, p, b) => { const r = await fetch(O + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return r.json().catch(() => ({})); };
const reg = await call('POST', '/api/auth/register', { name: 'هيا المُيسِّرة', email: 'fac@example.com', password: 'secret-123', consents: { processing: true } });
if (reg.error) await call('POST', '/api/auth/login', { email: 'fac@example.com', password: 'secret-123' });
else await call('POST', '/api/auth/verify', { token: link('fac@example.com').split('/').pop() });
const errs = [];
const b = await chromium.launch();
const fctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await fctx.addCookies([{ name: 'mohaki_session', value: cookie.split('=')[1], url: O }]);
const pf = await fctx.newPage(); pf.on('pageerror', (e) => errs.push(e.message));
await pf.goto(`${O}/app/#/assessments`);
await pf.waitForSelector('form[data-form="assess-new"]');
await pf.fill('input[name="company"]', 'شركة التقنية الأولى');
await pf.selectOption('select[name="role"]', process.env.ROLE || 'pm');
await pf.fill('textarea[name="candidates"]', 'أحمد سالم\nمنى فهد');
await pf.getByRole('button', { name: 'إنشاء التقييم' }).click();
await pf.waitForSelector('.board');
await pf.screenshot({ path: `${SH}/as-admin.png` });
const a = (await call('GET', '/api/assess')).assessments[0];
// المرشح: متصفح نظيف بلا حساب، على الجوال
const cctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const pc = await cctx.newPage(); pc.on('pageerror', (e) => errs.push(e.message));
await pc.goto(a.candidates[0].link);
await pc.waitForSelector('[data-act="assess-start"]');
await pc.screenshot({ path: `${SH}/as-intro.png` });
await pc.click('[data-act="assess-start"]');
if (await pc.locator('.hero').count()) errs.push('started without consent');
await pc.check('#assess-consent'); await pc.click('[data-act="assess-start"]');
await pc.waitForSelector('.hero');
if (await pc.locator('.nav a[href="#/work"]').count()) errs.push('work nav visible in assessment');
await pc.goto(`${O}/app/#/inbox`); await pc.waitForSelector('.inbox-list .item');
await pc.screenshot({ path: `${SH}/as-inbox.png` });
// مستند اليوم الأول
await pc.locator('.inbox-list .item', { hasText: process.env.ROLE === 'sales' ? 'ترتيب أولويات' : 'تحليل انخفاض' }).click();
await pc.fill('#doc', 'المشكلة: انخفاض استخدام التقارير من 58% إلى 41%. البيانات بالمقارنة تظهر أن السبب الأرجح بطء التقارير عند الحسابات الكبيرة. التوصية: نقترح إصلاح الأداء أولًا. مؤشر النجاح: قياس نسبة الاستخدام أسبوعيًا والهدف 55% خلال شهر.');
await pc.getByRole('button', { name: 'تسليم العمل' }).click();
await pc.waitForSelector('.outcome');
// إعادة التحميل تبقي الجلسة (من التبويب)
await pc.reload(); await pc.waitForSelector('.topbar');
if (!(await pc.locator('.side-foot').textContent()).includes('جلسة تقييم')) errs.push('assess mode lost after reload');
// ثلاثة أيام
for (let d = 1; d <= 3; d++) {
  await pc.locator('[data-act="end-day"]').click();
  await pc.locator('.modal [data-act="confirm-end-day"]').click();
  await pc.waitForTimeout(400);
  if (d < 3) await pc.locator('.modal [data-act="close-modal"]').click();
}
await pc.waitForTimeout(1500);
await pc.goto(a.candidates[0].link); await pc.waitForSelector('.outcome.good');
await pc.screenshot({ path: `${SH}/as-done.png` });
// الشركة تفتح التقرير بلا حساب
const rctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const pr = await rctx.newPage(); pr.on('pageerror', (e) => errs.push(e.message));
await pr.goto(a.reportLink); await pr.waitForSelector('.cand');
const first = await pr.locator('.cand').first().textContent();
if (!first.includes('أحمد') || !first.includes('أكمل')) errs.push(`report first row: ${first}`);
await pr.locator('.cand').first().click(); await pr.waitForSelector('.cand-detail');
await pr.screenshot({ path: `${SH}/as-report.png`, fullPage: true });
await b.close();
console.log(errs.length ? errs.join('\n') : 'ok');
