// فحص تجربة العمل الجديدة في متصفح حقيقي (المراحل 1–5): التهيئة، والبريد، والمكتب والتكليف،
// والزميل الحقيقي والدوري، والأعمال الواقعية.
// الاستخدام: MOHAKI_DATA_DIR=/tmp/x MOHAKI_FACILITATORS=fac@example.com npm start
//            ثم: MOHAKI_DATA_DIR=/tmp/x [SHOTS=مجلد_لقطات] node scripts/ui-experience.js
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'checks');
let failed = 0;
for (const n of [1, 2, 3, 4, 5, 'assess', 'research', 'market', 'plan', 'rotation', 'job']) {
  try {
    const out = execFileSync(process.execPath, [join(dir, typeof n === 'string' ? `${n}.mjs` : `phase${n}.mjs`)], { env: process.env, encoding: 'utf8', timeout: 180000 });
    const last = out.trim().split('\n').at(-1);
    console.log(`${last === 'ok' ? '✓' : '✗'} المرحلة ${n}: ${last}`);
    if (last !== 'ok') failed++;
  } catch (err) { failed++; console.log(`✗ المرحلة ${n}: ${String(err.stderr || err.message).split('\n').find((l) => l.trim()) ?? ''}`); }
}
process.exit(failed ? 1 : 0);
