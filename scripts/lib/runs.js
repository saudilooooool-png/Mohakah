// متدربون افتراضيون للاختبارات والفحوص: سجلات أفعال حتمية بالمحرك نفسه.
import { Simulation, loadCompany, loadScenario, loadOccupations } from '../../src/index.js';

export const world = { company: loadCompany('nova-tech'), scenario: loadScenario('pm-first-30-days'), occupations: loadOccupations() };
export const DOC = 'المشكلة انخفاض الاستخدام 41% مقابل 58%. البيانات والإيرادات والعملاء. السبب بطء. التوصية: نقترح ونوصي بالحل. الخيارات والبدائل. الميزانية والتكلفة والفريق. الجدول أسابيع على مراحل. مؤشر النجاح وقياس الهدف. المخاطر والتحديات. أنجزنا وأطلقنا. الخطوات القادمة. المستخدمين والشريحة. المتطلبات يجب. خارج النطاق لن نبني. '.repeat(3);

/** سجل أفعال متدرب جيد (أفضل خيار، كل الاعتراضات مجابة، مستندات مكتوبة). */
export function goodRun(seed = 9, { stopDay = Infinity } = {}) {
  const sim = new Simulation({ ...world, seed });
  const log = [];
  while (!sim.finished && sim.day <= stopDay) {
    for (const item of sim.inbox()) {
      if (item.deliverable) { sim.submitDeliverable(item.id, DOC); log.push({ t: 'deliver', itemId: item.id, text: DOC }); continue; }
      const best = [...item.options].sort((a, b) => b.quality - a.quality)[0];
      const extra = item.dialogue ? { addressed: item.dialogue.concerns.map((c) => c.id), transcript: [{ speaker: 'trainee', text: 'رد مدروس' }], mode: 'claude' } : {};
      sim.respond(item.id, best.id, { rationale: 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات في هذه المرحلة', ...extra });
      log.push({ t: 'respond', itemId: item.id, optionId: best.id, rationale: 'قرار مبني على البيانات وأثره على العملاء والفريق والإيرادات في هذه المرحلة', ...extra });
    }
    sim.endDay(); log.push({ t: 'endDay' });
  }
  return { seed, log };
}

