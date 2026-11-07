// وكلاء الاجتماع عبر Claude (يعمل على الخادم فقط — مفتاح API لا يصل إلى المتصفح).
import Anthropic from '@anthropic-ai/sdk';
import { MEETING_SYSTEM, meetingUserPrompt } from './prompts.js';
import { turnSchema, sanitizeTurn } from './meeting.js';

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
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      // عند رفض مصنّفات الأمان، يعيد الخادم الطلب على النموذج البديل الموصى به
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // الحوار تفاعلي ويحتاج سرعة: جهد منخفض يكفي لأداء الشخصيات والحكم بالمعيار
      output_config: {
        effort,
        format: { type: 'json_schema', schema: turnSchema(spec, optionIds, { closing }) },
      },
      system: [{ type: 'text', text: MEETING_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: meetingUserPrompt({ spec, options, people, context, meeting, message, closing, saudiContext }),
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
  let raw;
  try { raw = JSON.parse(text); } catch { throw new AgentError('رد النموذج ليس JSON صالحًا', 'invalid_json'); }
  try {
    return { ...sanitizeTurn(spec, optionIds, raw, { closing }), model: response.model };
  } catch (err) {
    throw new AgentError(err.message, 'invalid_turn');
  }
}
