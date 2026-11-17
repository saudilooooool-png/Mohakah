import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goodRun } from '../lib/runs.js';
const { chromium } = createRequire(import.meta.url)('playwright');
const O = 'http://localhost:4173'; const DATA = process.env.MOHAKI_DATA_DIR;
const SH = process.env.SHOTS || '/tmp';
const st = Date.now();
const link = (to) => { for (const f of readdirSync(join(DATA, 'outbox')).sort().reverse()) { const m = JSON.parse(readFileSync(join(DATA, 'outbox', f), 'utf8')); if (m.to === to && m.link?.includes('confirm-email')) return m.link; } };
async function acct(name, email) {
  let cookie = '';
  const call = async (m, p, b) => { const r = await fetch(O + p, { method: m, headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0]; return r.json().catch(() => ({})); };
  const r = await call('POST', '/api/auth/register', { name, email, password: 'secret-123', consents: { processing: true } });
  if (r.error) await call('POST', '/api/auth/login', { email, password: 'secret-123' }); // الحساب موجود من فحص سابق
  else await call('POST', '/api/auth/verify', { token: link(email).split('/').pop() });
  call.cookie = () => cookie.split('=')[1]; call.email = email;
  return call;
}
const errs = [];
const b = await chromium.launch();
const pageFor = async (c) => { const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); await ctx.addCookies([{ name: 'mohaki_session', value: c.cookie(), url: O }]); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); return p; };
const a = await acct('سارة العتيبي', `a${st}@x.sa`); const bb = await acct('خالد الحربي', `b${st}@x.sa`);
const fac = await acct('هيا المُيسِّرة', 'fac@example.com');
await a('PUT', '/api/progress', goodRun(3, { stopDay: 2 })); await bb('PUT', '/api/progress', goodRun(4, { stopDay: 3 }));
const pa = await pageFor(a); const pb = await pageFor(bb);
await pa.goto(`${O}/app/#/team`); await pa.waitForSelector('[data-act="pair-request"]'); await pa.click('[data-act="pair-request"]');
await pa.waitForSelector('[data-act="pair-cancel"]');
await pb.goto(`${O}/app/#/team`); await pb.waitForSelector('[data-act="pair-request"]'); await pb.click('[data-act="pair-request"]');
await pb.waitForTimeout(1500); await pb.screenshot({ path: SH + '/p4-dbg.png' }); await pb.waitForSelector('.real-partner a.btn'); await pb.screenshot({ path: `${SH}/p4-team.png` });
await pb.click('.real-partner a.btn'); await pb.waitForSelector('#pair-msg');
await pb.fill('#pair-msg', 'أهلًا سارة! أنا في اليوم الرابع. كيف تعاملتِ مع شكوى الأفق؟'); await pb.getByRole('button', { name: 'إرسال', exact: true }).click();
await pa.waitForSelector('.real-partner a.btn', { timeout: 9000 }); await pa.click('.real-partner a.btn');
await pa.waitForFunction(() => document.querySelector('[data-pair-msgs]')?.textContent.includes('شكوى الأفق'), null, { timeout: 8000 }).catch(() => errs.push('partner message not visible'));
await pa.screenshot({ path: `${SH}/p4-pair.png` });
// الدوري
const pf = await pageFor(fac);
await pf.goto(`${O}/app/#/leagues`); await pf.waitForSelector('form[data-form="league-create"]');
await pf.fill('#lg-n', 'دوري التجربة'); await pf.fill('input[name="team1"]', 'الصقور'); await pf.fill('textarea[name="emails1"]', a.email);
await pf.fill('input[name="team2"]', 'النجوم'); await pf.fill('textarea[name="emails2"]', bb.email);
await pf.getByRole('button', { name: 'إنشاء الدوري' }).click(); await pf.waitForSelector('.board');
const lid = (await pf.evaluate(() => location.hash)).split('/').pop();
await pa.goto(`${O}/app/#/league/${lid}`); await pa.waitForSelector('[data-act="league-join"]');
pa.on('dialog', (d) => d.accept());
await pa.click('[data-act="league-join"]'); await pa.waitForTimeout(2500);
await pa.goto(`${O}/app/#/league/${lid}`); await pa.waitForSelector('.board');
if (await pa.locator('[data-act="league-join"]').count()) errs.push('join button still there');
await pa.screenshot({ path: `${SH}/p4-league.png`, fullPage: true });
await b.close();
console.log(errs.length ? errs.join('\n') : 'ok');
