// فحص رحلة الحساب والسجل الموثّق في متصفح حقيقي.
// الاستخدام: MOHAKI_DATA_DIR=/tmp/x MOHAKI_EMPLOYER_TOKEN=t npm start ثم: node scripts/ui-accounts.js [مجلد_لقطات]
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:4173/app/';
const ORIGIN = new URL(BASE).origin;
const TOKEN = process.env.MOHAKI_EMPLOYER_TOKEN || 't';
const shots = process.argv[2];
const DATA = process.env.MOHAKI_DATA_DIR;
if (!DATA) { console.error('عيّن MOHAKI_DATA_DIR (نفس مجلد الخادم) لقراءة صندوق البريد الصادر'); process.exit(2); }
/** آخر رابط في صندوق البريد الصادر لبريد معين ونوع معين (كما يفعل المستخدم من بريده). */
const lastLink = (to, kind) => {
  const files = readdirSync(join(DATA, 'outbox')).sort();
  for (const f of files.reverse()) {
    const m = JSON.parse(readFileSync(join(DATA, 'outbox', f), 'utf8'));
    if (m.to === to && m.link?.includes(kind)) return m.link;
  }
  return null;
};
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const snap = async (n) => shots && page.screenshot({ path: `${shots}/acc-${n}.png`, fullPage: true });
const endDay = async () => {
  await page.locator('[data-act="end-day"]').click();
  await page.locator('.modal [data-act="confirm-end-day"]').click();
  await page.locator('.modal [data-act="close-modal"]').click();
};

// 1) ضيف: يومه الأول
await page.goto(BASE);
await snap('1-welcome');
await page.getByRole('button', { name: 'جرّب يومك الأول كضيف' }).click();
await page.waitForSelector('.guide');
check(await page.locator('.side-cta').count() === 1, 'الضيف لا يرى دعوة إنشاء الحساب');
await endDay();

// 2) اليوم الثاني: طلب إنشاء حساب
await page.locator('[data-act="end-day"]').click();
await page.waitForSelector('.modal h2');
check((await page.locator('.modal h2').textContent()).includes('أنشئ حسابًا'), 'لم يظهر طلب الحساب للضيف في اليوم الثاني');
await page.locator('.modal [data-act="open-auth"][data-mode="register"]').click();
await page.fill('#a-name', 'نورة العتيبي');
const EMAIL = `noura${Date.now()}@example.com`;
await page.fill('#a-email', EMAIL);
await page.fill('#a-pass', 'secret-123');
await page.locator('details.optional summary').click();
await page.fill('#a-uni', 'جامعة الأميرة نورة');
await page.fill('#a-major', 'نظم معلومات');
await snap('2-register');
await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
await page.waitForSelector('.modal .outcome.bad', { timeout: 1500 }).then(() => errors.push('قُبل التسجيل دون موافقة؟')).catch(() => {});
await page.locator('input[name="processing"]').check();
await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
await page.waitForFunction(() => !document.querySelector('.modal'));
check((await page.locator('.side-foot .me').textContent()).includes('نورة'), 'الاسم لا يظهر بعد التسجيل');
check(await page.locator('.verify-banner').count() === 1, 'لا يظهر تنبيه تأكيد البريد');

// 3) التقدم انتقل للحساب ويبقى بعد إعادة التحميل
await page.waitForTimeout(1200);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.topbar');
check((await page.locator('.day b').textContent()).includes('2'), 'لم يُسترجع التقدم من الخادم بعد مسح المتصفح');

// 4) إكمال الأيام (بالمحرك مباشرة لتسريع الفحص؛ كل فعل يُحفظ على الخادم)
await page.evaluate(async () => {
  const s = window.__mohaki.session;
  const doc = 'المشكلة انخفاض الاستخدام 41% مقابل 58%. البيانات والإيرادات والعملاء. السبب بطء. التوصية: نقترح ونوصي بالحل. الخيارات والبدائل. الميزانية والتكلفة والفريق. الجدول أسابيع على مراحل. مؤشر النجاح وقياس الهدف. المخاطر والتحديات. أنجزنا وأطلقنا. الخطوات القادمة. المستخدمين والشريحة. المتطلبات يجب. خارج النطاق لن نبني. '.repeat(3);
  while (!s.sim.finished) {
    for (const item of s.sim.inbox()) {
      if (item.deliverable) { s.deliver(item.id, doc); continue; }
      const best = [...item.options].sort((a, b) => b.quality - a.quality)[0];
      s.respond(item.id, best.id, 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات في هذه المرحلة من عمر الشركة',
        item.dialogue ? { addressed: item.dialogue.concerns.map((c) => c.id), transcript: [{ speaker: 'trainee', text: 'رد' }] } : {});
    }
    s.endDay();
  }
});
await page.goto(`${BASE}#/report`);
await page.waitForSelector('.points-card');
await snap('3-points');

// 5) الإصدار يتطلب بريدًا مؤكدًا: يفتح المتدرب رابط التأكيد من بريده
check(await page.getByRole('button', { name: 'إصدار سجل الأداء الموثّق' }).count() === 0, 'زر الإصدار ظاهر قبل تأكيد البريد');
const confirmLink = lastLink(EMAIL, 'confirm-email');
check(!!confirmLink, 'لم تُرسل رسالة تأكيد البريد');
await page.goto(confirmLink.replace(/^https?:\/\/[^/]+/, ORIGIN));
await page.waitForSelector('.outcome.good');
await snap('3b-confirmed');
await page.goto(`${BASE}#/report`);
await page.waitForSelector('.points-card');
check(await page.locator('.verify-banner').count() === 0, 'بقي تنبيه التأكيد بعد تأكيد البريد');
await page.getByRole('button', { name: 'إصدار سجل الأداء الموثّق' }).click();
await page.waitForSelector('a[href^="#/verify/"]');
const href = await page.locator('a[href^="#/verify/"]').first().getAttribute('href');
const code = href.split('/').pop();
check(/^MHK-/.test(code), `رمز غير صالح: ${code}`);

// 6) صفحة التحقق من جهاز آخر دون حساب
const other = await (await browser.newContext()).newPage();
await other.goto(`${BASE}#/verify/${code}`);
await other.waitForSelector('.certificate');
const certText = await other.locator('.certificate').textContent();
check(certText.includes('نورة العتيبي') && certText.includes('/ 1000'), 'صفحة التحقق لا تعرض الاسم والنقاط');
check(!certText.includes('@'), 'صفحة التحقق تكشف البريد');
check((await other.locator('.verify-note').textContent()).includes('ليس شهادة خبرة'), 'إخلاء المسؤولية مفقود');
shots && await other.screenshot({ path: `${shots}/acc-4-verify.png`, fullPage: true });

// 7) جهات التوظيف: لا يظهر قبل الموافقة، ويظهر بعدها
const talent = async () => (await (await fetch(`${ORIGIN}/api/talent`, { headers: { authorization: `Bearer ${TOKEN}` } })).json()).candidates ?? [];
check(!(await talent()).some((c) => c.code === code), 'ظهر المرشح لجهات التوظيف دون موافقة');
await page.goto(`${BASE}#/account`);
await page.locator('[data-act="toggle-sharing"]').click();
await page.waitForTimeout(500);
check((await talent()).some((c) => c.code === code && c.university === 'جامعة الأميرة نورة'), 'لم يظهر المرشح بعد الموافقة');
await snap('5-account');

// 8) الخروج يمسح التقدم من المتصفح
await page.locator('[data-act="logout"]').first().click();
await page.waitForSelector('.welcome');
check(!(await page.evaluate(() => localStorage.getItem('mohaki.session.v1'))), 'بقي التقدم في المتصفح بعد الخروج');

// 9) نسيت كلمة المرور: طلب الرابط، وفتحه من البريد، وتعيين كلمة جديدة
await page.getByRole('button', { name: 'لدي حساب' }).click();
await page.getByRole('button', { name: 'نسيت كلمة المرور؟' }).click();
await page.fill('#f-email', EMAIL);
await page.getByRole('button', { name: 'إرسال الرابط' }).click();
await page.waitForSelector('.modal .outcome.good');
const resetLink = lastLink(EMAIL, 'reset-password');
check(!!resetLink, 'لم تُرسل رسالة الاستعادة');
await page.goto(resetLink.replace(/^https?:\/\/[^/]+/, ORIGIN));
await page.fill('#r-pass', 'brand-new-789');
await page.fill('#r-pass2', 'brand-new-789');
await snap('6-reset');
await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
await page.waitForSelector('.outcome.good');
const login = async (pw) => (await fetch(`${ORIGIN}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: pw }) })).status;
check(await login('secret-123') === 401, 'كلمة المرور القديمة ما زالت تعمل');
check(await login('brand-new-789') === 200, 'كلمة المرور الجديدة لا تعمل');
await page.goto(`${BASE}#/desk`);
await page.waitForSelector('.topbar');
check((await page.locator('.side-foot .me').textContent()).includes('نورة'), 'لم يُسجّل الدخول بعد تعيين كلمة المرور');

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`✓ رحلة الحساب والسجل الموثّق تعمل (${code})`);
