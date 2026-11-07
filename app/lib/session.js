// جلسة المتدرب: تغلّف المحرك وتحفظ التقدم.
// الحفظ لا يخزن حالة الشركة، بل البذرة وسلسلة الأفعال فقط. لأن المحرك حتمي،
// إعادة تشغيل الأفعال تعيد العالم كما كان بالضبط (وهذا أيضًا سجل تدقيق كامل).
import { Simulation } from '../../src/engine/simulation.js';

const KEY = 'mohaki.session.v1';

export async function loadWorld() {
  const get = (p) => fetch(p).then((r) => {
    if (!r.ok) throw new Error(`تعذر تحميل ${p}`);
    return r.json();
  });
  const [company, scenario, ssco, profiles] = await Promise.all([
    get('../data/companies/nova-tech.json'),
    get('../data/scenarios/pm-first-30-days.json'),
    get('../data/occupations/ssco.json'),
    get('../data/occupations/ssco-profiles.json'),
  ]);
  return { company, scenario, occupations: { ...ssco, profiles: profiles.profiles } };
}

function readSave() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* التخزين غير متاح: نكمل دون حفظ */ }
}

export class Session {
  constructor(world, save) {
    this.world = world;
    this.seed = save.seed;
    this.startedAt = save.startedAt;
    this.log = [];
    // مراسلات الزملاء: معلومات فقط، لا تؤثر على المحرك، فتُحفظ كما هي دون إعادة تشغيل
    this.threads = save.threads ?? {};
    this.sim = new Simulation({ company: world.company, scenario: world.scenario, seed: this.seed, occupations: world.occupations });
    for (const a of save.log ?? []) {
      try { this._apply(a); this.log.push(a); } catch (e) { console.warn('تعذرت إعادة فعل محفوظ', a, e); break; }
    }
  }

  static hasSave() { return !!readSave(); }

  static resume(world) {
    const save = readSave();
    return save ? new Session(world, save) : null;
  }

  static start(world, seed = Math.floor(Math.random() * 1e6) + 1) {
    const s = new Session(world, { seed, startedAt: new Date().toISOString(), log: [] });
    s._persist();
    return s;
  }

  static clear() { try { localStorage.removeItem(KEY); } catch { /* */ } }

  respond(itemId, optionId, rationale, extra = {}) {
    return this._do({ t: 'respond', itemId, optionId, rationale, ...extra });
  }

  deliver(itemId, text) {
    return this._do({ t: 'deliver', itemId, text });
  }

  endDay() {
    return this._do({ t: 'endDay' });
  }

  thread(personId) { return this.threads[personId] ?? []; }

  /** عدد رسائل المتدرب لزميل في يوم العمل الحالي. */
  sentToday(personId) {
    const day = this.sim.day;
    return this.thread(personId).filter((m) => m.speaker === 'trainee' && m.day === day).length;
  }

  addMessages(personId, messages) {
    this.threads[personId] = [...this.thread(personId), ...messages].slice(-200);
    this._persist();
  }

  person(id) {
    return this.world.company.people.find((p) => p.id === id)
      ?? { id, name: id, title: '' };
  }

  _do(action) {
    const result = this._apply(action);
    this.log.push(action);
    this._persist();
    return result;
  }

  _apply(a) {
    if (a.t === 'respond') {
      return this.sim.respond(a.itemId, a.optionId, {
        rationale: a.rationale, transcript: a.transcript ?? null, addressed: a.addressed ?? null, mode: a.mode ?? null,
      });
    }
    if (a.t === 'deliver') return this.sim.submitDeliverable(a.itemId, a.text);
    if (a.t === 'endDay') return this.sim.endDay();
    throw new Error(`فعل غير معروف: ${a.t}`);
  }

  _persist() {
    writeSave({ seed: this.seed, startedAt: this.startedAt, log: this.log, threads: this.threads });
  }
}
