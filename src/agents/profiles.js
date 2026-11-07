// ملفات تكلفة جاهزة: أي نموذج لكل نوع من التفاعل، أو الوضع المحلي (دون تكلفة).
//   meeting   = الاجتماعات الحوارية (الحكم على الاعتراضات فيها يدخل في التقييم)
//   chat      = المحادثات الحرة (الرسائل والشكاوى)
//   colleague = مراسلة الزملاء (معلومات فقط، لا تُقيَّم)
export const PROFILES = {
  // التجربة المغلقة بأقل تكلفة: Haiku للحوارات، والمراسلة بالوضع المحلي
  economy: {
    meeting: { model: 'claude-haiku-5-5', effort: 'low' },
    chat: { model: 'claude-haiku-5-5', effort: 'low' },
    colleague: { model: 'offline' },
  },
  // توازن: Sonnet للاجتماعات حيث الحكم أصعب، وHaiku لغيرها
  balanced: {
    meeting: { model: 'claude-sonnet-5-5', effort: 'low' },
    chat: { model: 'claude-haiku-5-5', effort: 'low' },
    colleague: { model: 'claude-haiku-5-5', effort: 'low' },
  },
  // أعلى جودة: Opus لكل شيء
  quality: {
    meeting: { model: 'claude-opus-5-5', effort: 'low' },
    chat: { model: 'claude-opus-5-5', effort: 'low' },
    colleague: { model: 'claude-opus-5-5', effort: 'low' },
  },
  // دون أي استدعاء: الاختبار الداخلي المجاني
  offline: {
    meeting: { model: 'offline' },
    chat: { model: 'offline' },
    colleague: { model: 'offline' },
  },
};

export const ROUTES = ['meeting', 'chat', 'colleague'];

/**
 * يحدد النموذج والجهد لكل مسار من MOHAKI_AI_PROFILE (الافتراضي economy)،
 * مع إمكانية تجاوز مسار واحد: MOHAKI_MODEL_MEETING=claude-sonnet-5-5 أو =offline.
 */
export function resolveRoutes(env = process.env) {
  const name = PROFILES[env.MOHAKI_AI_PROFILE] ? env.MOHAKI_AI_PROFILE : 'economy';
  const base = PROFILES[name];
  const routes = {};
  for (const r of ROUTES) {
    const override = env[`MOHAKI_MODEL_${r.toUpperCase()}`];
    routes[r] = { ...base[r], ...(override ? { model: override } : {}) };
    if (routes[r].model !== 'offline' && !routes[r].effort) routes[r].effort = env.MOHAKI_AGENT_EFFORT || 'low';
  }
  return { profile: name, routes };
}
