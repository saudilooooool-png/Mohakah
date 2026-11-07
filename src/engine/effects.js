// لغة "الآثار": كل قرار أو حدث يغيّر حالة الشركة عبر عمليات صريحة قابلة للتدقيق،
// وليس عبر أرقام يخترعها نموذج لغوي.

const BOUNDED_0_100 = [
  /^company\.productQuality$/,
  /^company\.brand$/,
  /^company\.team\.morale$/,
  /^company\.tail\.avgHealth$/,
  /^company\.features\.[^.]+\.usage$/,
  /^player\.trust\.[^.]+$/,
];

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  if (BOUNDED_0_100.some((re) => re.test(path))) value = clamp(value, 0, 100);
  if (/^company\.supportBacklog$/.test(path)) value = Math.max(0, value);
  target[last] = value;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function checkCondition(state, cond) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every((c) => checkCondition(state, c));
  const v = getPath(state, cond.path);
  switch (cond.op) {
    case 'lt': return v < cond.value;
    case 'gt': return v > cond.value;
    case 'eq': return v === cond.value;
    case 'exists': return v !== undefined && v !== null;
    case 'notExists': return v === undefined || v === null;
    default: throw new Error(`شرط غير معروف: ${cond.op}`);
  }
}

/**
 * يطبّق قائمة آثار على الحالة. `ctx.sim` يتيح الآثار التي تحتاج المحاكي
 * (جدولة أحداث، إضافة بنود للخارطة، تسجيل في سجل الشركة).
 */
export function applyEffects(state, effects = [], ctx = {}) {
  for (const e of effects) {
    switch (e.op) {
      case 'add':
        setPath(state, e.path, (getPath(state, e.path) ?? 0) + e.value);
        break;
      case 'multiply':
        setPath(state, e.path, (getPath(state, e.path) ?? 0) * e.value);
        break;
      case 'set':
        setPath(state, e.path, e.value);
        break;
      case 'trust':
        setPath(state, `player.trust.${e.who}`, (state.player.trust[e.who] ?? 50) + e.value);
        break;
      case 'accountHealth': {
        const acc = state.company.accounts.find((a) => a.id === e.id);
        if (acc && acc.status === 'active') acc.health = clamp(acc.health + e.value, 0, 100);
        break;
      }
      case 'accountMrr': {
        const acc = state.company.accounts.find((a) => a.id === e.id);
        if (acc && acc.status === 'active') acc.mrr = Math.max(0, acc.mrr + e.value);
        break;
      }
      case 'loseAccount': {
        const acc = state.company.accounts.find((a) => a.id === e.id);
        if (acc && acc.status === 'active') {
          acc.status = 'lost';
          ctx.sim?.log(`خسرت الشركة حساب ${acc.name} (${acc.mrr.toLocaleString('en')} ريال شهريًا).`, 'bad');
        }
        break;
      }
      case 'competitorPrice': {
        const c = state.company.competitors.find((x) => x.id === e.id);
        if (c) c.seatPrice = Math.round(c.seatPrice * e.factor);
        break;
      }
      case 'roadmapAdd':
        ctx.sim?.addRoadmapItem(e.item);
        break;
      case 'roadmapRemove':
        ctx.sim?.removeRoadmapItem(e.id);
        break;
      case 'flag':
        state.flags[e.name] = e.value ?? true;
        break;
      case 'spawn':
        ctx.sim?.scheduleEvent(e.event, e.inDays ?? 0);
        break;
      case 'schedule':
        ctx.sim?.scheduleEffects(e.effects, e.inDays, e.note);
        break;
      case 'log':
        ctx.sim?.log(e.text, e.tone ?? 'info');
        break;
      default:
        throw new Error(`أثر غير معروف: ${e.op}`);
    }
  }
}
