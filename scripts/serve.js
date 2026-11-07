// تشغيل محاكي محليًا: npm start ثم افتح http://localhost:4173/app/
// لتفعيل وكلاء Claude: عيّن ANTHROPIC_API_KEY قبل التشغيل (يبقى المفتاح على الخادم).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMohakiServer } from '../src/server.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 4173;

createMohakiServer({ root }).listen(port, async () => {
  console.log(`محاكي يعمل على http://localhost:${port}/app/`);
  const st = await (await fetch(`http://localhost:${port}/api/agents/status`)).json();
  console.log(st.mode === 'claude'
    ? `وكلاء الذكاء الاصطناعي: Claude (${st.model})`
    : 'وكلاء الذكاء الاصطناعي: الوضع المحلي (لتفعيل Claude: عيّن ANTHROPIC_API_KEY ثم أعد التشغيل)');
});
