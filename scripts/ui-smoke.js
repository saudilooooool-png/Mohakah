// فحص آلي سريع لواجهة العمل في متصفح حقيقي (يتطلب Playwright مثبتًا).
// الاستخدام: npm start  (في نافذة أخرى)  ثم: node scripts/ui-smoke.js [مجلد_لقطات]
import { createRequire } from 'node:module';

const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:4173/app/';
const shots = process.argv[2];
const errors = [];
const browser = await chromium.launch();

async function run(viewport, tag) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ar' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(`[${tag}] ${m.text()}`); });
  const snap = async (name) => shots && page.screenshot({ path: `${shots}/${tag}-${name}.png`, fullPage: true });

  await page.goto(BASE);
  await page.getByRole('button', { name: 'ابدأ يومك الوظيفي' }).click();
  await page.waitForSelector('.hero');
  await snap('1-desk');

  // قرار: شكوى العميل
  await page.goto(`${BASE}#/inbox`);
  await page.locator('.inbox-list .item').first().click();
  await page.locator('.opt').first().click();
  await page.fill('#why', 'العميل استراتيجي ويجب أن أفهم المشكلة منه مباشرة قبل أي وعد.');
  await snap('2-decision');
  await page.getByRole('button', { name: 'اعتماد القرار' }).click();
  await page.waitForSelector('.outcome');

  // مستند: تحليل التقارير
  await page.goto(`${BASE}#/inbox`);
  const docItem = page.locator('.inbox-list .item', { hasText: 'تحليل انخفاض' });
  await docItem.click();
  await page.fill('#doc', 'المشكلة: انخفاض استخدام التقارير من 58% إلى 41%. البيانات بالمقارنة تظهر أن السبب الأرجح بطء التقارير. التوصية: نقترح إصلاح الأداء أولًا. مؤشر النجاح: قياس نسبة الاستخدام أسبوعيًا والهدف 55%.');
  await snap('3-editor');
  await page.getByRole('button', { name: 'تسليم العمل' }).click();
  await page.waitForSelector('.outcome .check');
  await snap('4-delivered');

  // إنهاء اليوم
  await page.getByRole('button', { name: /إنهاء يوم العمل/ }).click();
  await page.waitForSelector('.modal');
  await page.locator('.modal [data-act="confirm-end-day"]').click();
  await page.waitForSelector('.mini-kpis');
  await page.waitForTimeout(250);
  await snap('5-day-summary');
  await page.locator('.modal [data-act="close-modal"]').click();

  // الحفظ: إعادة التحميل تعيد نفس اليوم
  await page.reload();
  await page.waitForSelector('.topbar');
  const dayText = await page.locator('.day b').textContent();
  if (!dayText.includes('2')) errors.push(`[${tag}] لم يُستعد اليوم بعد إعادة التحميل: ${dayText}`);

  for (const p of ['team', 'meetings', 'files', 'company', 'feed', 'report']) {
    await page.goto(`${BASE}#/${p}`);
    await page.waitForSelector('.page-h');
    await snap(`6-${p}`);
  }

  // لا تمرير أفقي على أي شاشة
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push(`[${tag}] تمرير أفقي بمقدار ${overflow}px`);
  await ctx.close();
}

await run({ width: 1366, height: 860 }, 'desktop');
await run({ width: 390, height: 844 }, 'mobile');
await browser.close();

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('✓ واجهة العمل تعمل على سطح المكتب والجوال دون أخطاء');
