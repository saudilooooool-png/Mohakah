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
  // التسجيل: المسار الطبيعي لإكمال أكثر من يوم
  await page.getByRole('button', { name: 'أنشئ حسابًا وابدأ' }).click();
  await page.fill('#a-name', 'متدرب الفحص');
  await page.fill('#a-email', `smoke-${tag}-${Date.now()}@example.com`);
  await page.fill('#a-pass', 'secret-123');
  await page.locator('input[name="processing"]').check();
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await page.waitForFunction(() => !document.querySelector('.modal'));
  await page.getByRole('button', { name: 'ابدأ يومك الوظيفي' }).click();
  await page.waitForSelector('.hero');
  await snap('1-desk');

  // محادثة حرة: شكوى العميل (مع العميل نفسه)
  await page.goto(`${BASE}#/inbox`);
  await page.locator('.inbox-list .item').first().click();
  await page.getByRole('button', { name: 'ابدأ المحادثة' }).click();
  await page.waitForSelector('.minutes .bubble');
  await page.fill('#say', 'أفهم أن تعطل التقارير في نهاية الشهر يؤثر على اجتماع إدارتكم. أخبرني: أي التقارير تتعطل ومتى؟ وسأتواصل معك بتحديث يوم الأحد بعد مراجعة الفريق، ونبحث حلًا مؤقتًا.');
  await snap('2-chat');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await page.waitForSelector('.bubble.me');
  await page.getByRole('button', { name: 'إنهاء المحادثة' }).click();
  await page.waitForSelector('.outcome', { timeout: 15000 });
  const chatOutcome = await page.locator('.outcome h3').textContent();
  if (!chatOutcome.includes('نتيجة المحادثة')) errors.push(`[${tag}] نتيجة محادثة غير متوقعة: ${chatOutcome}`);

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

  // مراسلة زميل من صفحة فريقي
  await page.goto(`${BASE}#/team`);
  await page.getByRole('link', { name: /راسل فهد/ }).click();
  await page.waitForSelector('#msg');
  await page.fill('#msg', 'كم نسبة استخدام التقارير الآن؟');
  await page.getByRole('button', { name: 'إرسال', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.chat-thread .bubble:not(.me):not(.typing)').length >= 1);
  const answer = await page.locator('.chat-thread .bubble:not(.me) .said').last().textContent();
  if (!answer.includes('58%')) errors.push(`[${tag}] رد فهد لا يحمل بيانات الاستخدام: ${answer}`);
  await snap('6-colleague');
  await page.reload();
  await page.waitForSelector('.chat-thread');
  if ((await page.locator('.chat-thread .bubble').count()) < 2) errors.push(`[${tag}] لم تُحفظ المراسلة بعد إعادة التحميل`);

  for (const p of ['team', 'meetings', 'files', 'company', 'feed', 'report']) {
    await page.goto(`${BASE}#/${p}`);
    await page.waitForSelector('.page-h');
    await snap(`6-${p}`);
  }

  // الاجتماعات الحوارية: تخطيط السبرنت (اليوم 3) ثم اجتماع الإدارة (اليوم 5)
  const dayIs = async (n) => (await page.locator('.day b').textContent()).trim().endsWith(` ${n}`);
  const endDay = async () => {
    await page.locator('[data-act="end-day"]').click();
    await page.locator('.modal [data-act="confirm-end-day"]').click();
    await page.locator('.modal [data-act="close-modal"]').click();
  };
  async function playMeeting(title, text, expected, shotPrefix) {
    await page.goto(`${BASE}#/meetings`);
    await page.locator('.item', { hasText: title }).click();
    await page.getByRole('button', { name: /ادخل الاجتماع|ابدأ المحادثة/ }).click();
    await page.waitForSelector('.minutes .bubble');
    if (shotPrefix) await snap(`${shotPrefix}-open`);
    await page.fill('#say', text);
    await page.getByRole('button', { name: 'إرسال', exact: true }).click();
    await page.waitForSelector('.bubble.me');
    await page.waitForSelector('.concern.ok');
    if (shotPrefix) await snap(`${shotPrefix}-round`);
    await page.getByRole('button', { name: /اختتام الاجتماع|إنهاء المحادثة/ }).click();
    await page.waitForSelector('.outcome', { timeout: 15000 });
    const outcome = await page.locator('.outcome h3').textContent();
    if (!outcome.includes(expected)) errors.push(`[${tag}] نتيجة غير متوقعة في «${title}»: ${outcome}`);
    if (shotPrefix) await snap(`${shotPrefix}-minutes`);
  }

  while (!(await dayIs(3))) await endDay();
  await playMeeting('تخطيط السبرنت',
    'نبدأ بإصلاح أداء التقارير بندًا واحدًا: 22 نقطة جهد تكفيها سعة الفريق في أسبوعين، ونؤجل الباقي. الاستخدام نزل من 58% إلى 41% والأفق مهددة بالإلغاء. وحملات واتساب نعود إليها في السبرنت القادم بعد أن يرسل ماجد بيانات الصفقات.',
    'إصلاح أداء التقارير', '7-sprint');
  await page.goto(`${BASE}#/company`);
  if (!(await page.locator('.barrow', { hasText: 'إعادة بناء أداء التقارير' }).count())) errors.push(`[${tag}] قرار السبرنت لم يصل إلى خارطة الطريق`);

  while (!(await dayIs(5))) await endDay();
  await playMeeting('اجتماع الإدارة',
    'نوصي بإصلاح التقارير أولًا لأنه يحمي الإيرادات: الأفق تدفع 18500 ريال شهريًا. سنقيس النجاح بمؤشر الاستخدام ونسبة الإلغاء في مراجعة بعد أسبوعين. لعملاء واتساب نعطي موعدًا واضحًا بعد الإصلاح ولا تضيع الصفقات. والإصلاح 22 نقطة جهد أي نحو أسبوعين بسعة الفريق، أولوية واحدة.',
    'دافع بالأرقام', '8-mgmt');

  while (!(await dayIs(15))) await endDay();
  await playMeeting('تخفيض الميزانيات',
    'أقترح أن نوقف التعاقدات الخارجية غير الحرجة، وهذا يوفر قرابة 20 ألف ريال شهريًا ويطيل المدرج. لا نمس ميزانية الإعلانات حتى لا نخسر العملاء الجدد ونحافظ على النمو، ولا نلغي أدوات التطوير حتى لا تتأثر سعة الفريق في السبرنت.',
    'أوقف التعاقدات الخارجية', '9-budget');

  while (!(await dayIs(20))) await endDay();
  await playMeeting('جاهزية الإصدار',
    'نطلق لمجموعة تجريبية من عشرين عميلًا ونضم رواسي إليها حتى يلتزم ماجد بالموعد. أخطاء التصدير والجوال غير حرجة، ونراقبها أسبوعًا مع خطة تراجع ونصلحها قبل التوسع. ونبلغ العملاء بالأخطاء المعروفة مسبقًا، وتجهز أمل ردودًا جاهزة لفريق الدعم.',
    'مجموعة تجريبية', '11-release');

  while (!(await dayIs(23))) await endDay();
  await playMeeting('اجتماع فردي مع فهد',
    'تقرير الإلغاءات الذي وصل للإدارة كان فيه أرقام خاطئة، واضطر سلطان لتصحيح ما قاله للمستثمرين. أخبرني ما الذي حدث من جهتك؟ أريد أن أفهم السبب. ثم نتفق على خطة: الطلبات تمر عبري بأولوية واحدة، ومراجعة قبل الإرسال، ومتابعة أسبوعية.',
    'ملاحظة محددة', '10-1on1');

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
