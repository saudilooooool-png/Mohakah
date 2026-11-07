// مراسلة الزملاء في أي وقت: أسئلة للحصول على معلومات، لا قرارات.
// لا تغيّر المراسلة حالة الشركة. الزميل يجيب من معرفته المخزنة في بيانات الشركة
// (وبعضها يُملأ من أرقام المحرك الحية)، ولا يعرف ما لم يحدث بعد (fromDay).

export const MAX_COLLEAGUE_MESSAGE = 800;
export const DAILY_LIMIT = 6;

const normalize = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[إأآا]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[ً-ْ]/g, '');

const fmt = (n) => (typeof n === 'number' ? Math.round(n).toLocaleString('en') : n);

/** يحوّل لقطة الحالة إلى قيم جاهزة للقوالب. */
export function templateValues(ctx = {}) {
  const features = ctx.features ?? {};
  return {
    mrr: fmt(ctx.mrr), customers: fmt(ctx.customers), cash: fmt(ctx.cash),
    runwayMonths: ctx.runwayMonths ?? 'غير محدد', avgHealth: fmt(ctx.avgHealth),
    supportBacklog: fmt(ctx.supportBacklog), morale: fmt(ctx.morale),
    seatPrice: fmt(ctx.seatPrice), marketingBudget: fmt(ctx.marketingBudget),
    featuresList: Object.entries(features).map(([k, v]) => `${k} ${v}%`).join('، ') || 'غير متاح',
    accountsAtRisk: (ctx.accountsAtRisk ?? []).join('، ') || 'لا يوجد حساب في دائرة الخطر الآن',
    competitorsList: (ctx.competitors ?? []).map((c) => `${c.name} ${c.seatPrice} ريالًا`).join('، ') || 'غير متاح',
    roadmapActive: ctx.roadmap?.active || 'لا شيء بعد',
    roadmapQueue: (ctx.roadmap?.queue ?? []).join('، ') || 'لا شيء',
    features,
  };
}

export function fillTemplate(text, values) {
  return text.replace(/\{([^}]+)\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), values);
    return v === undefined || v === null ? '؟' : String(v);
  });
}

/** المعرفة المتاحة لزميل في يوم معين، بعد ملء الأرقام الحية. */
export function knowledgeFor(person, ctx, day) {
  const values = templateValues(ctx);
  return (person.knowledge ?? []).map((k) => {
    const available = !k.fromDay || day >= k.fromDay;
    if (!available && !k.before) return null;
    return { id: k.id, keywords: k.keywords, text: fillTemplate(available ? k.text : k.before, values) };
  }).filter(Boolean);
}

const score = (entry, body) => entry.keywords.filter((w) => body.includes(normalize(w))).length;

/** الرد المحلي (دون نموذج لغوي): أقرب معلومة، أو توجيه للزميل المختص. */
export function offlineColleagueReply({ person, people, ctx, day, message }) {
  const body = normalize(message);
  if (/(السلام|مرحبا|صباح الخير|مساء الخير|اهلا)/.test(body) && body.length < 25) {
    return 'أهلًا! تفضل، كيف أساعدك؟';
  }
  const mine = knowledgeFor(person, ctx, day)
    .map((k) => ({ k, s: score(k, body) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (mine.length) return mine.slice(0, 2).map((x) => x.k.text).join(' ');
  let best = null;
  for (const other of people.filter((p) => p.id !== person.id && !p.external && p.knowledge)) {
    for (const k of other.knowledge) {
      const s = score(k, body);
      if (s > 0 && (!best || s > best.s)) best = { other, s };
    }
  }
  if (best) return `هذا ليس من اختصاصي. الأفضل أن تسأل ${best.other.name} (${best.other.title}).`;
  return 'لست متأكدًا مما تقصد. هل يمكن أن تحدد سؤالك أكثر؟';
}

export function colleagueSchema() {
  return {
    type: 'object',
    properties: { reply: { type: 'string' } },
    required: ['reply'],
    additionalProperties: false,
  };
}

export function sanitizeColleagueReply(raw) {
  const reply = typeof raw?.reply === 'string' ? raw.reply.trim() : '';
  if (!reply) throw new Error('رد الزميل فارغ');
  return { reply: reply.slice(0, 700) };
}

/** هل يمكن مراسلة هذا الشخص من صفحة فريقي؟ */
export const canMessage = (person) => !!person && !person.external && Array.isArray(person.knowledge) && person.knowledge.length > 0;
