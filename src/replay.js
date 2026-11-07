// إعادة بناء العالم من البذرة وسلسلة الأفعال. يستخدمها المتصفح (الحفظ والاستئناف)
// والخادم (التحقق من النتيجة قبل إصدار السجل: لا يثق الخادم بأي رقم يحسبه المتصفح).
import { Simulation } from './engine/simulation.js';

/**
 * تطبيق فعل واحد. reviews: تصحيحات المُيسِّر { [itemId]: { addressed, optionId } } تُطبَّق فوق
 * حكم الوكيل الأصلي دون تعديل السجل نفسه (يبقى الأصل محفوظًا للتدقيق).
 */
export function applyAction(sim, a, reviews = null) {
  if (a.t === 'respond') {
    const r = reviews?.[a.itemId];
    return sim.respond(a.itemId, r?.optionId ?? a.optionId, {
      rationale: a.rationale ?? '', transcript: a.transcript ?? null,
      addressed: r?.addressed ?? a.addressed ?? null, mode: r ? 'reviewed' : a.mode ?? null,
    });
  }
  if (a.t === 'deliver') return sim.submitDeliverable(a.itemId, a.text);
  if (a.t === 'endDay') return sim.endDay();
  throw new Error(`فعل غير معروف: ${a.t}`);
}

/**
 * @param {{company, scenario, occupations?}} world
 * @param {{seed:number, log:Array}} save
 * @param {{strict?: boolean}} opts strict: يرمي خطأ عند أول فعل غير صالح (للخادم)
 */
export function replay(world, { seed, log = [], reviews = null }, { strict = false } = {}) {
  const sim = new Simulation({ company: world.company, scenario: world.scenario, seed, occupations: world.occupations ?? null });
  const applied = [];
  for (const a of log) {
    try {
      applyAction(sim, a, reviews);
      applied.push(a);
    } catch (err) {
      if (strict) throw new Error(`فعل غير صالح رقم ${applied.length + 1}: ${err.message}`);
      break;
    }
  }
  return { sim, applied };
}
