// إعادة بناء العالم من البذرة وسلسلة الأفعال. يستخدمها المتصفح (الحفظ والاستئناف)
// والخادم (التحقق من النتيجة قبل إصدار السجل: لا يثق الخادم بأي رقم يحسبه المتصفح).
import { Simulation } from './engine/simulation.js';

export function applyAction(sim, a) {
  if (a.t === 'respond') {
    return sim.respond(a.itemId, a.optionId, {
      rationale: a.rationale ?? '', transcript: a.transcript ?? null, addressed: a.addressed ?? null, mode: a.mode ?? null,
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
export function replay(world, { seed, log = [] }, { strict = false } = {}) {
  const sim = new Simulation({ company: world.company, scenario: world.scenario, seed, occupations: world.occupations ?? null });
  const applied = [];
  for (const a of log) {
    try {
      applyAction(sim, a);
      applied.push(a);
    } catch (err) {
      if (strict) throw new Error(`فعل غير صالح رقم ${applied.length + 1}: ${err.message}`);
      break;
    }
  }
  return { sim, applied };
}
