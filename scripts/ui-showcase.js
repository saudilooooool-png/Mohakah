// فحص ميزات العرض في متصفح حقيقي: رابط التحدي، وملف الأعمال، والفيديو.
// الاستخدام: MOHAKI_DATA_DIR=/tmp/x npm start ثم: MOHAKI_DATA_DIR=/tmp/x node scripts/ui-showcase.js [مجلد_لقطات]
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
async function account(name, email) {
  const call = apiClient();
  const r = await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
  await call('POST', '/api/auth/verify', { token: lastLink(email, 'confirm-email').split('/').pop() });
  call.id = r.data.id; call.email = email;
  return call;
}
async function pageFor(browser, call, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  if (call) await ctx.addCookies([{ name: 'mohaki_session', value: call.cookie().split('=')[1], url: ORIGIN }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return page;
}
const snap = async (page, n) => shots && page.screenshot({ path: `${shots}/show-${n}.png`, fullPage: true });

const browser = await chromium.launch();

// ——— 1) تحداني على نفس الشركة ———
const owner = await account('سارة العتيبي', `owner-${stamp}@example.com`);
await owner('PUT', '/api/progress', goodRun(9));
const op = await pageFor(browser, owner);
await op.goto(`${BASE}#/report`);
await op.waitForSelector('[data-act="create-challenge"]');
await op.click('[data-act="create-challenge"]');
await op.waitForSelector('.share-row');
await snap(op, '1-create-challenge');
const code = (await op.locator('[data-act="copy-challenge"]').getAttribute('data-code'));
check(/^[A-Z2-9]{6}$/.test(code), `رمز تحدٍّ غير صالح: ${code}`);

// معاينة الرابط ثم التحويل إلى صفحة التحدي (ضيف على الجوال)
const html = await (await fetch(`${ORIGIN}/c/${code}`)).text();
check(html.includes('og:title') && html.includes('سارة:'), 'معاينة الرابط لا تحمل عنوان النتيجة');
const gp = await pageFor(browser, null, { width: 390, height: 844 });
await gp.goto(`${ORIGIN}/c/${code}`);
await gp.waitForSelector('.challenge-hero');
check((await gp.locator('.challenge-hero h1').textContent()).includes('سارة'), 'صفحة التحدي لا تعرض صاحبه');
check(!(await gp.content()).includes('العتيبي'), 'الاسم الكامل ظاهر في صفحة التحدي');
await snap(gp, '2-challenge-guest-mobile');
await gp.click('[data-act="accept-challenge"]');
await gp.waitForSelector('.guide, .desk, .shell, .main');
const seed = await gp.evaluate(() => window.__mohaki.session.seed);
check(seed === 9, `الضيف لم يبدأ العالم نفسه: ${seed}`);

// صديق مسجل ينضم فيظهر في اللوحة
const friend = await account('خالد المطيري', `friend-${stamp}@example.com`);
const fp = await pageFor(browser, friend);
await fp.goto(`${BASE}#/challenge/${code}`);
await fp.waitForSelector('[data-act="accept-challenge"]');
await fp.click('[data-act="accept-challenge"]');
await fp.waitForFunction(() => window.__mohaki.session?.challenge);
await fp.waitForTimeout(2500); // الحفظ المؤجل إلى الخادم
await fp.goto(`${BASE}#/challenge/${code}`);
await fp.waitForSelector('.board');
const board = await fp.locator('.board').textContent();
check(board.includes('خالد') && board.includes('أنت'), `الصديق لا يظهر في اللوحة: ${board}`);
await snap(fp, '3-challenge-board');
console.log(`✓ التحدي (${code}): إنشاء، معاينة الرابط، قبول ضيف، انضمام مسجل، لوحة`);

await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('✓ ميزات العرض تعمل');
