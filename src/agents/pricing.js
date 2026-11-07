// أسعار النماذج (دولار لكل مليون توكن) لحساب التكلفة الفعلية من response.usage.
// المصدر: جدول أسعار Anthropic (أكتوبر 2026). راجعها قبل الاعتماد عليها في الميزانية.
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 }, // للطلبات حتى 100 ألف توكن
};

/** تكلفة طلب واحد بالدولار. كتابة الذاكرة المؤقتة (5 دقائق) = 1.25 × سعر الإدخال. */
export function costOf(model, usage = {}) {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
  const m = 1e6;
  return ((usage.input_tokens ?? 0) * p.input
    + (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25
    + (usage.cache_read_input_tokens ?? 0) * p.cacheRead
    + (usage.output_tokens ?? 0) * p.output) / m;
}
