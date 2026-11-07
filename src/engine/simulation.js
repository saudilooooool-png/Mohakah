// المحاكي: يربط الشركة (الحالة) بالأحداث والقرارات والمحرك الاقتصادي والتقييم.
// كل ما يحدث يُسجَّل كدليل، ومنه يُبنى السجل المهني.
import { createRng } from './rng.js';
import { applyEffects, checkCondition } from './effects.js';
import { tickDay, snapshot } from './economy.js';
import { scoreDeliverable } from './deliverables.js';
import { buildReport } from './evaluation.js';

const clone = (x) => structuredClone(x);
const PRIORITY_RANK = { critical: 3, high: 2, normal: 1, low: 0 };

export class Simulation {
  /**
   * @param {object} opts
   * @param {object} opts.company   بيانات الشركة الأولية (data/companies/*.json)
   * @param {object} opts.scenario  سيناريو الدور (data/scenarios/*.json)
   * @param {number} [opts.seed]    بذرة العالم — نفس البذرة = نفس الأحداث العشوائية
   */
  constructor({ company, scenario, seed = 1 }) {
    this.seed = seed;
    this.companyData = company;
    this.scenario = scenario;
    this.rngEvents = createRng(seed * 7919 + 1);
    this.rngWorld = createRng(seed * 104729 + 2);
    this.eventDefs = new Map(scenario.events.map((e) => [e.id, e]));
    this.firedRandom = new Set();

    const co = clone(company.state);
    co.tail.churnAcc = 0;
    co.pipelineAcc = 0;
    co.roadmap ??= { active: null, queue: [], shipped: [] };
    this.state = {
      day: 1,
      company: co,
      player: { role: scenario.role, trust: clone(scenario.initialTrust) },
      flags: {},
    };
    this.items = [];          // صندوق العمل: رسائل، مهام، اجتماعات، شكاوى
    this.scheduledEvents = []; // {day, eventId}
    this.scheduledEffects = []; // {day, effects, note}
    this.feed = [];           // سجل الشركة: ما الذي حدث ولماذا
    this.actions = [];        // سجل أفعال المتدرب (الأدلة)
    this.history = [];        // لقطة يومية من مؤشرات الشركة
    this._seq = 0;

    this.history.push(snapshot(this.state));
    this._startDay();
  }

  get day() { return this.state.day; }
  get lastDay() { return this.scenario.lengthDays; }
  get finished() { return this.state.day > this.lastDay; }

  // ——— واجهة المتدرب ———

  inbox() {
    return this.items
      .filter((i) => i.status === 'open')
      .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.dueDay - b.dueDay);
  }

  /**
   * الرد على بند في صندوق العمل باختيار أحد الخيارات المسموح بها.
   * في الاجتماعات الحوارية: `transcript` محضر الاجتماع، و`addressed` معرّفات الاعتراضات
   * التي حكم الوكيل بأنها أُجيبت. المحرك يقبل فقط المعرّفات المعرّفة في السيناريو،
   * ويطبّق آثارها كما يحددها السيناريو.
   */
  respond(itemId, optionId, { rationale = '', transcript = null, addressed = null, mode = null } = {}) {
    const item = this._openItem(itemId);
    const option = item.options.find((o) => o.id === optionId);
    if (!option) throw new Error(`الخيار ${optionId} غير متاح في ${itemId}`);
    const concerns = item.dialogue?.concerns ?? [];
    const valid = addressed ? concerns.filter((c) => addressed.includes(c.id)) : [];
    this._recordAction(item, {
      kind: 'decision', optionId, rationale, quality: option.quality ?? null,
      ...(item.dialogue ? { transcript, addressed: valid.map((c) => c.id), concernsTotal: concerns.length, mode } : {}),
    });
    item.status = 'done';
    item.resolution = { optionId, day: this.day };
    if (option.result) this.log(option.result, option.tone ?? 'info');
    applyEffects(this.state, option.effects, { sim: this });
    for (const c of valid) applyEffects(this.state, c.onAddressed, { sim: this });
    return option;
  }

  /** تسليم مخرَج مكتوب (تحليل، عرض، وثيقة متطلبات...). */
  submitDeliverable(itemId, text) {
    const item = this._openItem(itemId);
    if (!item.deliverable) throw new Error(`${itemId} لا يتطلب تسليم مستند`);
    const evaluation = scoreDeliverable(item.deliverable, text);
    this._recordAction(item, { kind: 'deliverable', evaluation, text });
    item.status = 'done';
    item.resolution = { day: this.day, score: evaluation.score };
    const good = evaluation.score >= (item.deliverable.passScore ?? 0.6);
    const branch = good ? item.deliverable.onGood : item.deliverable.onWeak;
    if (branch?.result) this.log(branch.result, good ? 'good' : 'bad');
    applyEffects(this.state, branch?.effects, { sim: this });
    return evaluation;
  }

  /** إنهاء يوم العمل: تنتهي المهلات، تعمل الشركة، تظهر النتائج، ويبدأ يوم جديد. */
  endDay() {
    if (this.finished) throw new Error('انتهت فترة المحاكاة');
    // 1) البنود التي فات موعدها بلا تصرف
    for (const item of this.items.filter((i) => i.status === 'open' && i.dueDay <= this.day)) {
      item.status = 'expired';
      this.actions.push({ day: this.day, itemId: item.id, eventId: item.eventId, kind: 'expired', priority: item.priority, onTime: false, category: item.category });
      if (item.onExpire?.result) this.log(item.onExpire.result, 'bad');
      applyEffects(this.state, item.onExpire?.effects, { sim: this });
    }
    // 2) الآثار المؤجلة المستحقة اليوم
    for (const s of this.scheduledEffects.filter((x) => x.day === this.day)) {
      if (s.note) this.log(s.note, 'info');
      applyEffects(this.state, s.effects, { sim: this });
    }
    // 3) فريق التطوير يعمل على خارطة الطريق
    this._progressRoadmap();
    // 4) الشركة تعمل: مال، عملاء، دعم، فريق
    for (const n of tickDay(this.state, this.rngWorld)) this.log(n.text, n.tone);
    this.history.push(snapshot(this.state));
    // 5) يوم جديد
    this.state.day += 1;
    if (!this.finished) this._startDay();
  }

  dashboard() {
    const c = this.state.company;
    return {
      ...snapshot(this.state),
      trust: { ...this.state.player.trust },
      roadmap: {
        active: c.roadmap.active && { ...c.roadmap.active },
        queue: c.roadmap.queue.map((x) => x.title),
        shipped: c.roadmap.shipped.map((x) => x.title),
      },
      features: Object.fromEntries(Object.entries(c.features).map(([k, f]) => [k, Math.round(f.usage)])),
      competitors: c.competitors.map((x) => ({ name: x.name, seatPrice: x.seatPrice })),
    };
  }

  /** التقرير المهني: مبني على الأدلة ومقارنة بعالم مطابق لم يتصرف فيه أحد. */
  report() {
    return buildReport(this, () => Simulation.runBaseline(this.companyData, this.scenario, this.seed, this.history.length - 1));
  }

  /** عالم موازٍ بنفس البذرة لا يتخذ فيه المتدرب أي قرار — خط الأساس للمقارنة. */
  static runBaseline(company, scenario, seed, days) {
    const sim = new Simulation({ company, scenario, seed });
    for (let i = 0; i < days && !sim.finished; i++) sim.endDay();
    return sim;
  }

  // ——— أدوات تستخدمها الآثار ———

  log(text, tone = 'info') { this.feed.push({ day: this.day, text, tone }); }

  scheduleEvent(eventId, inDays = 0) {
    if (!this.eventDefs.has(eventId)) throw new Error(`حدث غير معروف: ${eventId}`);
    if (inDays <= 0) this._fire(this.eventDefs.get(eventId));
    else this.scheduledEvents.push({ day: this.day + inDays, eventId });
  }

  scheduleEffects(effects, inDays = 1, note) {
    this.scheduledEffects.push({ day: this.day + Math.max(1, inDays) - 1, effects, note });
  }

  addRoadmapItem(item) {
    const r = this.state.company.roadmap;
    const all = [r.active, ...r.queue, ...r.shipped].filter(Boolean);
    if (all.some((x) => x.id === item.id)) return;
    const entry = { ...clone(item), progress: 0 };
    if (!r.active) r.active = entry; else if (item.urgent) { r.queue.unshift(r.active); r.active = entry; } else r.queue.push(entry);
    this.log(`أضيف إلى خارطة الطريق: ${item.title} (${item.effort} نقطة جهد).`, 'info');
  }

  removeRoadmapItem(id) {
    const r = this.state.company.roadmap;
    if (r.active?.id === id) r.active = r.queue.shift() ?? null;
    r.queue = r.queue.filter((x) => x.id !== id);
  }

  // ——— داخلي ———

  _startDay() {
    for (const e of this.scenario.events.filter((x) => x.day === this.day)) this._fire(e);
    for (const s of this.scheduledEvents.filter((x) => x.day === this.day)) this._fire(this.eventDefs.get(s.eventId));
    this._maybeRandomEvent();
  }

  _maybeRandomEvent() {
    const pool = this.scenario.randomEvents ?? [];
    const cfg = this.scenario.randomEventChance ?? 0.3;
    // نستهلك رقمين عشوائيين كل يوم دائمًا حتى يبقى التسلسل متطابقًا بين العوالم المتوازية
    const roll = this.rngEvents.next();
    const pickRoll = this.rngEvents.next();
    if (roll >= cfg) return;
    const candidates = pool.filter((e) =>
      this.day >= (e.minDay ?? 1)
      && !(e.once !== false && this.firedRandom.has(e.id))
      && checkCondition(this.state, e.condition));
    const total = candidates.reduce((s, e) => s + (e.weight ?? 1), 0);
    if (!total) return;
    let r = pickRoll * total;
    const pick = candidates.find((e) => (r -= e.weight ?? 1) < 0) ?? candidates[candidates.length - 1];
    this.firedRandom.add(pick.id);
    this._fire(pick);
  }

  _fire(def) {
    if (def.condition && !checkCondition(this.state, def.condition)) return;
    if (def.onFire?.result) this.log(def.onFire.result, def.onFire.tone ?? 'info');
    applyEffects(this.state, def.onFire?.effects, { sim: this });
    if (def.type === 'notice') {
      if (def.body) this.log(def.body, def.tone ?? 'info');
      return;
    }
    this.items.push({
      id: `${def.id}#${++this._seq}`,
      eventId: def.id,
      type: def.type,
      category: def.category ?? def.type,
      from: def.from,
      priority: def.priority ?? 'normal',
      title: def.title,
      body: def.body,
      createdDay: this.day,
      dueDay: this.day + (def.dueInDays ?? 1) - 1,
      options: def.options ?? [],
      deliverable: def.deliverable ?? null,
      dialogue: def.dialogue ?? null,
      onExpire: def.onExpire ?? null,
      skills: def.skills ?? [],
      status: 'open',
    });
  }

  _openItem(itemId) {
    const item = this.items.find((i) => i.id === itemId || i.eventId === itemId && i.status === 'open');
    if (!item) throw new Error(`لا يوجد بند ${itemId}`);
    if (item.status !== 'open') throw new Error(`البند ${itemId} مغلق (${item.status})`);
    return item;
  }

  _recordAction(item, data) {
    // الأولوية: هل كان هناك بند أهم مفتوح ولم يُعالج بعد؟
    const higherOpen = this.items.filter((i) => i.status === 'open' && i !== item
      && PRIORITY_RANK[i.priority] > PRIORITY_RANK[item.priority]).length;
    this.actions.push({
      day: this.day, itemId: item.id, eventId: item.eventId, priority: item.priority,
      category: item.category, skills: item.skills, onTime: this.day <= item.dueDay,
      higherPriorityOpen: higherOpen, ...data,
    });
  }

  _progressRoadmap() {
    const c = this.state.company;
    const r = c.roadmap;
    if (!r.active) return;
    r.active.progress += c.team.devCapacityPerDay * (c.team.morale / 70);
    if (r.active.progress >= r.active.effort) {
      const done = r.active;
      done.shippedDay = this.day;
      r.shipped.push(done);
      r.active = r.queue.shift() ?? null;
      this.log(`تم إطلاق: ${done.title}.`, 'good');
      applyEffects(this.state, done.onShip, { sim: this });
    }
  }
}
