// تقدير تكلفة Claude لكل متدرب ولعدد من المتدربين، لكل ملف تكلفة.
// يبني التعليمات الفعلية التي يرسلها المنتج لكل جولة في كل حوار بالسيناريو، ويعدّ توكناتها:
//   - إن وُجد ANTHROPIC_API_KEY: بنقطة عدّ التوكنات الرسمية (مجانية) لمعايرة النسبة
//   - وإلا: تقدير من طول النص العربي (هامش خطأ واسع، ±40%)
// الاستخدام: node scripts/estimate-cost.js [--trainees 50] [--output 400] [--colleague 15]
import { loadCompany, loadScenario } from '../src/index.js';
import { MEETING_SYSTEM, meetingPromptParts, COLLEAGUE_SYSTEM, colleaguePromptParts } from '../src/agents/prompts.js';
import { openMeeting } from '../src/agents/meeting.js';
import { knowledgeFor } from '../src/agents/colleague.js';
import { PROFILES } from '../src/agents/profiles.js';
import { PRICES } from '../src/agents/pricing.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? Number(process.argv[i + 1]) : def; };
const TRAINEES = arg('trainees', 50);
const OUTPUT = arg('output', 400);           // توكنات الإخراج لكل استدعاء (الرد + تفكير قليل بجهد low)
const COLLEAGUE_MSGS = arg('colleague', 15); // رسائل الزملاء لكل متدرب خلال التجربة
const CHARS_PER_TOKEN = 2.5;                 // تقدير للنص العربي دون عدّ رسمي

const company = loadCompany('nova-tech');
const scenario = loadScenario('pm-first-30-days');
const sampleMessage = 'نوصي بالبدء بالأولوية الأهم لأن البيانات تظهر أثرها على العملاء والإيرادات، وسنقيس النجاح بمؤشر واضح خلال أسبوعين، ونتفق مع الفريق على ما يؤجل.';
const ctx = {
  day: 10, mrr: 430000, customers: 190, cash: 5600000, runwayMonths: 19, productQuality: 68, avgHealth: 66, supportBacklog: 30, morale: 66,
  trust: Object.fromEntries(Object.keys(scenario.initialTrust).map((k) => [k, 55])),
  roadmap: { active: 'إعادة بناء أداء التقارير', queue: [] },
  features: { 'التقارير': 45, 'تكامل واتساب': 24 }, accountsAtRisk: [],
  competitors: [{ name: 'قمة CRM', seatPrice: 67 }], seatPrice: 89, marketingBudget: 60000,
};

// كل الاستدعاءات التي يجريها متدرب واحد (بمتوسط جولات واقعي)
const calls = [];
const dialogues = scenario.events.filter((e) => e.dialogue);
const RANDOM_SHARE = 2; // متوسط الأحداث العشوائية الحوارية التي تظهر لكل متدرب
for (const e of [...dialogues, ...scenario.randomEvents.filter((x) => x.dialogue).slice(0, RANDOM_SHARE)]) {
  const route = e.dialogue.mode === 'chat' ? 'chat' : 'meeting';
  const item = { id: e.id, eventId: e.id, dialogue: e.dialogue };
  let m = openMeeting(item);
  const rounds = route === 'chat' ? 1.5 : 2; // متوسط الجولات قبل الختام
  const full = Math.ceil(rounds);
  const args = { spec: e.dialogue, options: e.options, people: company.people, context: ctx, saudiContext: company.saudiContext };
  for (let r = 0; r <= full; r++) {
    const closing = r === full;
    const parts = meetingPromptParts({ ...args, meeting: m, message: closing ? '' : sampleMessage, closing });
    const weight = !closing && r === full - 1 && rounds % 1 ? rounds % 1 : 1;
    calls.push({ route, system: MEETING_SYSTEM, ...parts, firstOfDialogue: r === 0, weight });
    m = { ...m, round: m.round + (closing ? 0 : 1), transcript: [...m.transcript, { speaker: 'trainee', text: sampleMessage }, { speaker: e.dialogue.chair, text: 'رد قصير من المشارك.' }] };
  }
}
const analyst = company.people.find((p) => p.id === 'analyst');
for (let i = 0; i < COLLEAGUE_MSGS; i++) {
  const parts = colleaguePromptParts({
    person: analyst, people: company.people, knowledge: knowledgeFor(analyst, ctx, 10), context: ctx,
    thread: [], message: 'كم نسبة استخدام التقارير الآن؟', saudiContext: company.saudiContext,
  });
  calls.push({ route: 'colleague', system: COLLEAGUE_SYSTEM, ...parts, firstOfDialogue: i === 0, weight: 1 });
}

// عدّ التوكنات
let ratio = 1 / CHARS_PER_TOKEN;
let method = `تقدير من طول النص (${CHARS_PER_TOKEN} حرف/توكن، هامش ±40%)`;
if (process.env.ANTHROPIC_API_KEY) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const sample = calls[0];
  const text = `${sample.system}\n${sample.stable}\n${sample.volatile}`;
  const r = await client.messages.countTokens({
    model: 'claude-haiku-5-5', system: sample.system,
    messages: [{ role: 'user', content: `${sample.stable}\n${sample.volatile}` }],
  });
  ratio = r.input_tokens / text.length;
  method = `معايرة بنقطة عدّ التوكنات الرسمية (${(1 / ratio).toFixed(2)} حرف/توكن)`;
}
const tok = (s) => Math.round(s.length * ratio);

function costFor(profileName) {
  const profile = PROFILES[profileName];
  let usd = 0;
  for (const c of calls) {
    const cfg = profile[c.route];
    if (cfg.model === 'offline') continue;
    const p = PRICES[cfg.model];
    const cached = tok(c.system) + tok(c.stable);
    // أول جولة في الحوار تكتب الذاكرة المؤقتة (1.25×)، والجولات التالية تقرأ منها (سعر القراءة)
    const inputCost = c.firstOfDialogue ? cached * p.input * 1.25 : cached * p.cacheRead;
    usd += c.weight * (inputCost + tok(c.volatile) * p.input + OUTPUT * p.output) / 1e6;
  }
  return usd;
}

const count = (r) => calls.filter((c) => c.route === r).reduce((s, c) => s + c.weight, 0);
const avgIn = Math.round(calls.reduce((s, c) => s + tok(c.system) + tok(c.stable) + tok(c.volatile), 0) / calls.length);
const SAR = 3.75;
console.log(`طريقة العدّ: ${method}`);
console.log(`الاستدعاءات لكل متدرب: اجتماعات ${count('meeting')} · محادثات ${count('chat')} · زملاء ${count('colleague')} · متوسط الإدخال ${avgIn} توكن · الإخراج ${OUTPUT} توكن\n`);
console.log(`الملف       | لكل متدرب              | لـ${TRAINEES} متدربًا`);
for (const name of ['offline', 'economy', 'balanced', 'quality']) {
  const usd = costFor(name);
  console.log(`${name.padEnd(11)} | $${usd.toFixed(3).padStart(6)} (${(usd * SAR).toFixed(2)} ر.س) | $${(usd * TRAINEES).toFixed(2)} (${(usd * TRAINEES * SAR).toFixed(0)} ر.س)`);
}
console.log('\nالافتراضات: جولتان في الاجتماع وجولة ونصف في المحادثة قبل الختام، وحدثان عشوائيان حواريان، والضيوف يعملون محليًا.');
console.log('للتكلفة الفعلية أثناء التجربة: GET /api/admin/usage');
