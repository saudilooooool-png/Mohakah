// يلتقط صور المنتج المستخدمة في موقع التسويق (site/assets).
// الاستخدام: MOHAKI_DATA_DIR=/tmp/x npm start ثم: node scripts/site-shots.js
import { createRequire } from 'node:module';
import { goodRun } from './lib/runs.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const ORIGIN = process.env.BASE_ORIGIN || 'http://localhost:4173';
const OUT = new URL('../site/assets/', import.meta.url).pathname;

async function client(name, email) {
  let cookie = '';
  const call = async (m, p, b) => {
    const r = await fetch(ORIGIN + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined });
    const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0];
    return r.json().catch(() => ({}));
  };
  await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
  call.cookie = () => cookie.split('=')[1];
  return call;
}

const b = await chromium.launch();
const stamp = Date.now();
async function pageFor(call, viewport = { width: 1280, height: 860 }) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'mohaki_session', value: call.cookie(), url: ORIGIN }]);
  return ctx.newPage();
}

// 1) اجتماع الإدارة أثناء الحوار
const a = await client('ريم القحطاني', `shot-a-${stamp}@example.com`);
await a('PUT', '/api/progress', goodRun(9, { stopDay: 4 }));
const p1 = await pageFor(a);
await p1.goto(`${ORIGIN}/app/#/inbox`);
await p1.locator('.inbox-list .item', { hasText: 'اجتماع الإدارة' }).first().click();
await p1.getByRole('button', { name: 'ادخل الاجتماع' }).click();
await p1.waitForSelector('#say');
await p1.waitForTimeout(800);
await p1.fill('#say', 'أقترح أن نبدأ بإصلاح أداء التقارير: 40% من تذاكر الدعم عنها، وهي سبب أول لانخفاض الاستخدام من 58% إلى 41%. نقيس النجاح برفع الاستخدام إلى 50% خلال شهر، ونعطي المبيعات موعدًا لتكامل واتساب في الربع القادم.');
await p1.getByRole('button', { name: 'إرسال', exact: true }).click();
await p1.waitForTimeout(1500);
await p1.addStyleTag({ content: '.topbar{position:static!important} .verify-banner,.banner{display:none!important}' });
await p1.locator('.minutes').first().screenshot({ path: `${OUT}shot-meeting.png` });

// 2) التقرير والنقاط بعد شهر كامل
const c = await client('ريم القحطاني', `shot-c-${stamp}@example.com`);
await c('PUT', '/api/progress', goodRun(9));
const p2 = await pageFor(c);
await p2.goto(`${ORIGIN}/app/#/report`);
await p2.waitForSelector('.score-ring');
await p2.waitForTimeout(500);
const cards = p2.locator('.content > section.card, .content section.card');
await cards.nth(0).screenshot({ path: `${OUT}shot-report.png` });
await cards.nth(1).screenshot({ path: `${OUT}shot-points.png` });

// 3) ملف الأعمال: منحنى الأثر
const ed = await c('GET', '/api/portfolio/me');
const { portfolio } = await c('PUT', '/api/portfolio/me', { headline: 'مديرة منتجات تبني القرار على البيانات', displayName: 'full', published: true, selections: { deliverables: [ed.candidates.deliverables[0].id], decisions: ed.candidates.decisions.slice(4, 7).map((x) => x.id), quotes: [] } });
const p3 = await pageFor(c, { width: 900, height: 900 });
await p3.goto(`${ORIGIN}/p/${portfolio.slug}`);
await p3.waitForSelector('.versus');
await p3.locator('.pf-wrap > section.card').nth(1).screenshot({ path: `${OUT}shot-impact.png` });
await p3.locator('.pf-hero').screenshot({ path: `${OUT}shot-portfolio.png` });

await b.close();
console.log('✓ site/assets: shot-meeting, shot-report, shot-points, shot-impact, shot-portfolio');
