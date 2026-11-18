// جلسة المتدرب: تغلّف المحرك وتحفظ التقدم.
// الحفظ لا يخزن حالة الشركة، بل البذرة وسلسلة الأفعال فقط. لأن المحرك حتمي،
// إعادة تشغيل الأفعال تعيد العالم كما كان بالضبط (وهذا أيضًا سجل تدقيق كامل).
import { Simulation } from '../../src/engine/simulation.js';
import { applyAction } from '../../src/replay.js';

let KEY = 'mohaki.session.v1';
/** جلسة التقييم تُحفظ بمفتاح خاص حتى لا تختلط بتقدم المتدرب العادي. */
export function setStorageKey(k) { KEY = k; }

export async function loadWorld() {
  const get = (p) => fetch(p).then((r) => {
    if (!r.ok) throw new Error(`تعذر تحميل ${p}`);
    return r.json();
  });
  const [company, scenario, ssco, profiles, library, quiz, salesMonth, csMonth, rPm, rSales, rCs] = await Promise.all([
    get('../data/companies/nova-tech.json'),
    get('../data/scenarios/pm-first-30-days.json'),
    get('../data/occupations/ssco.json'),
    get('../data/occupations/ssco-profiles.json'),
    get('../data/library/nova-tech.json'),
    get('../data/questions/pm.json'),
    get('../data/scenarios/sales-month.json'),
    get('../data/scenarios/cs-month.json'),
    get('../data/roles/pm.json'), get('../data/roles/sales.json'), get('../data/roles/cs.json'),
  ]);
  return { company, scenario, occupations: { ...ssco, profiles: profiles.profiles }, library, quiz, scenarios: { 'sales-month': salesMonth, 'cs-month': csMonth }, roles: { pm: rPm, sales: rSales, cs: rCs } };
}

function readSave() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* التخزين غير متاح: نكمل دون حفظ */ }
}

export class Session {
  constructor(world, save) {
    // شهر الدور الذي اختاره المتدرب (مبيعات أو نجاح عملاء)، وإلا السيناريو الأساسي
    this.scenarioId = save.scenario && world.scenarios?.[save.scenario] ? save.scenario : null;
    if (this.scenarioId) world = { ...world, scenario: world.scenarios[this.scenarioId] };
    this.world = world;
    this.seed = save.seed;
    this.startedAt = save.startedAt;
    this.log = [];
    // مراسلات الزملاء: معلومات فقط، لا تؤثر على المحرك، فتُحفظ كما هي دون إعادة تشغيل
    this.threads = save.threads ?? {};
    // تصحيحات المُيسِّر من الخادم: تُطبَّق فوق الأفعال عند إعادة البناء
    this.reviews = save.reviews ?? {};
    // رمز التحدي الذي انضم إليه المتدرب (نفس البذرة)، إن وُجد
    this.challenge = save.challenge ?? null;
    this.league = save.league ?? null;
    this.read = save.read ?? {};
    this.opened = save.opened ?? {};
    // أسئلة تنمية المهارات: { [معرّف السؤال]: 1 صحيح | 0 خطأ }. للتعلم، لا تدخل في النقاط الرسمية.
    this.quiz = save.quiz ?? {};
    this.quizDay = {};
    // هدف المتدرب: أي وظيفة يسعى إليها، وما الذي ينقصه. تُبنى عليه خطته.
    this.goal = save.goal ?? null;
    this.videoMade = save.videoMade ?? 0;
    this.sim = new Simulation({ company: world.company, scenario: world.scenario, seed: this.seed, occupations: world.occupations });
    for (const a of save.log ?? []) {
      try { this._apply(a); this.log.push(a); } catch (e) { console.warn('تعذرت إعادة فعل محفوظ', a, e); break; }
    }
  }

  static hasSave() { return !!readSave(); }
  static localSave() { return readSave(); }

  static resume(world) {
    const save = readSave();
    return save ? new Session(world, save) : null;
  }

  /** من حفظ خادمي (حساب مسجل). */
  static fromSave(world, save) {
    const s = new Session(world, save);
    s._persist();
    return s;
  }

  /** بيانات الحفظ الحالية (لرفعها إلى الخادم). */
  saveData() { return { ...(this.scenarioId ? { scenario: this.scenarioId } : {}), seed: this.seed, startedAt: this.startedAt, log: this.log, threads: this.threads, reviews: this.reviews, read: this.read, opened: this.opened, quiz: this.quiz, goal: this.goal, videoMade: this.videoMade, ...(this.challenge ? { challenge: this.challenge } : {}), ...(this.league ? { league: this.league } : {}) }; }

  static start(world, seed = Math.floor(Math.random() * 1e6) + 1, { challenge = null, league = null, scenario = null, goal = null } = {}) {
    const s = new Session(world, { seed, startedAt: new Date().toISOString(), log: [], challenge, league, scenario, goal });
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

  /** مهام البحث: استفسار من مصدر، وتسليم الجواب، وساعة عمل مكتبي حتى تجهز الطلبات. */
  investigate(itemId, sourceId) { return this._do({ t: 'investigate', itemId, sourceId }); }
  research(itemId, answers) { return this._do({ t: 'research', itemId, answers }); }
  wait() { return this._do({ t: 'wait' }); }
  /** جلسة تعارف لبناء العلاقة مع زميل أو جهة اتصال خارجية. */
  connect(personId) { return this._do({ t: 'connect', personId }); }

  /** إسناد بند إلى الزميل المنفّذ بنص تكليف. */
  delegate(itemId, brief) {
    return this._do({ t: 'delegate', itemId, brief });
  }

  /** إبلاغ عن اكتشاف من المكتبة (فعل يُعاد تشغيله على الخادم كأي قرار). */
  insight(id) {
    return this._do({ t: 'insight', id });
  }

  setGoal(goal) { this.goal = goal; this._persist(); }
  markVideo() { this.videoMade = 1; this._persist(); }

  answerQuiz(id, correct) {
    this.quiz = { ...this.quiz, [id]: correct ? 1 : 0 };
    this.quizDay[this.sim.day] = (this.quizDay[this.sim.day] ?? 0) + 1;
    this._persist();
  }

  /** الرسائل المفتوحة في البريد (مقروء/غير مقروء): للواجهة فقط. */
  markOpened(id) {
    if (this.opened[id]) return;
    this.opened = { ...this.opened, [id]: this.sim.day };
    this._persist();
  }

  /** المستندات المقروءة: معلومة للواجهة فقط، لا تؤثر على المحرك. */
  markRead(docId) {
    this.read = { ...(this.read ?? {}), [docId]: this.sim.day };
    this._persist();
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

  _apply(a) { return applyAction(this.sim, a, this.reviews); }

  _persist() {
    const data = this.saveData();
    writeSave(data);
    this.onSave?.(data);
  }
}
