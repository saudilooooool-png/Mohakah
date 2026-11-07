// وكلاء الاجتماع عبر Claude (يعمل على الخادم فقط — مفتاح API لا يصل إلى المتصفح).
import Anthropic from '@anthropic-ai/sdk';
import { MEETING_SYSTEM, meetingPromptParts, COLLEAGUE_SYSTEM, colleaguePromptParts } from './prompts.js';
import { turnSchema, sanitizeTurn } from './meeting.js';
import { colleagueSchema, sanitizeColleagueReply } from './colleague.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export class AgentError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

/**
 * ينشئ عميل Claude إن توفرت بيانات اعتماد، وإلا يعيد null (فيعمل الاجتماع بالوضع المحلي).
 * MOHAKI_AGENTS=claude يفرض استخدام Claude (مثلًا مع ملف تعريف `ant auth login` دون متغير بيئة)،
 * وMOHAKI_AGENTS=offline يفرض الوضع المحلي.
 */
export function createClaudeClient(env = process.env) {
  if (env.MOHAKI_AGENTS === 'offline') return null;
  const hasCreds = env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.MOHAKI_AGENTS === 'claude';
  if (!hasCreds) return null;
  try {
    return new Anthropic();
  } catch {
    return null;
  }
}

// النماذج التي تدعم البديل التلقائي على الخادم عند الرفض (Haiku 5.5 لا يدعمه)
const SUPPORTS_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-opus-5']);

/**
 * طلب واحد إلى Claude بمخرجات منظمة، مع معالجة الرفض والأخطاء. يعيد { raw, model, usage }.
 * user = { stable, volatile }: الجزء الثابت يُخزن مؤقتًا، فتقرأه الجولات التالية من الحوار نفسه بعُشر السعر.
 */
async function structuredCall(client, { model, effort, system, user, schema }) {
  const fallback = SUPPORTS_FALLBACK.has(model)
    ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } // عند الرفض: النموذج البديل الموصى به
    : {};
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      ...fallback,
      output_config: { effort, format: { type: 'json_schema', schema } },
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: user.stable, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: user.volatile },
        ],
      }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AgentError('بيانات اعتماد Claude غير صالحة', 'auth');
    if (err instanceof Anthropic.RateLimitError) throw new AgentError('تجاوز حد الطلبات', 'rate_limit');
    if (err instanceof Anthropic.APIError) throw new AgentError(`خطأ من واجهة Claude (${err.status ?? 'اتصال'})`, 'api');
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new AgentError('رفض النموذج إكمال الرد', 'refusal');
  if (response.stop_reason === 'max_tokens') throw new AgentError('انقطع رد النموذج', 'max_tokens');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return { raw: JSON.parse(text), model: response.model, usage: response.usage ?? {} }; } catch { throw new AgentError('رد النموذج ليس JSON صالحًا', 'invalid_json'); }
}

/** رد زميل على رسالة المتدرب (مراسلة من صفحة فريقي). */
export async function claudeColleagueReply(client, {
  person, people, knowledge, context, thread, message, saudiContext = null,
  model = process.env.MOHAKI_AGENT_MODEL || DEFAULT_MODEL,
  effort = process.env.MOHAKI_AGENT_EFFORT || 'low',
}) {
  const { raw, model: served, usage } = await structuredCall(client, {
    model, effort, system: COLLEAGUE_SYSTEM, schema: colleagueSchema(),
    user: colleaguePromptParts({ person, people, knowledge, context, thread, message, saudiContext }),
  });
  try { return { ...sanitizeColleagueReply(raw), model: served, usage }; } catch (err) { throw new AgentError(err.message, 'invalid_turn'); }
}

/**
 * جولة اجتماع واحدة. يعيد ردًا تم التحقق منه بمواصفات السيناريو.
 * @param {Anthropic} client
 */
export async function claudeMeetingTurn(client, {
  spec, options, people, context, meeting, message, closing = false, saudiContext = null,
  model = process.env.MOHAKI_AGENT_MODEL || DEFAULT_MODEL,
  effort = process.env.MOHAKI_AGENT_EFFORT || 'low',
}) {
  const optionIds = options.map((o) => o.id);
  const { raw, model: served, usage } = await structuredCall(client, {
    model, effort, system: MEETING_SYSTEM, schema: turnSchema(spec, optionIds, { closing }),
    user: meetingPromptParts({ spec, options, people, context, meeting, message, closing, saudiContext }),
  });
  try {
    return { ...sanitizeTurn(spec, optionIds, raw, { closing }), model: served, usage };
  } catch (err) {
    throw new AgentError(err.message, 'invalid_turn');
  }
}
