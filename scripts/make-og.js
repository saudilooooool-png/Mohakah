// يولّد صورة معاينة الروابط (1200×630) لروابط التحدي: node scripts/make-og.js
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const mark = readFileSync(new URL('../app/assets/mark.svg', import.meta.url), 'utf8');
const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap" rel="stylesheet">
<style>body{margin:0;width:1200px;height:630px;background:#0B1F44;color:#fff;font-family:'IBM Plex Sans Arabic',sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;position:relative;overflow:hidden}
.k{color:#00C2D1;font-size:30px;font-weight:700;margin-bottom:10px}h1{font-size:76px;line-height:1.15;margin:0 0 22px}p{font-size:32px;color:#c9d4ea;margin:0}
.b{position:absolute;top:56px;left:90px;display:flex;align-items:center;gap:14px;font-size:30px;font-weight:700}.b svg{width:56px;height:56px}
.bar{position:absolute;bottom:0;right:0;left:0;height:14px;background:linear-gradient(90deg,#F5B301,#00C2D1)}</style></head>
<body><div class="b">${mark}<span>محاكي · MOHAKI</span></div><div class="k">تحدٍّ مفتوح</div><h1>نفس الشركة. نفس الأحداث.<br>تقدر تتفوق؟</h1><p>شهر كامل كمدير منتجات في NOVA TECH: قرارات لها عواقب، واجتماعات مع زملاء يعترضون.</p><div class="bar"></div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html, { waitUntil: 'networkidle' }).catch(() => p.setContent(html));
await p.waitForTimeout(500);
await p.screenshot({ path: new URL('../app/assets/og-challenge.png', import.meta.url).pathname });
await b.close();
console.log('✓ app/assets/og-challenge.png');
