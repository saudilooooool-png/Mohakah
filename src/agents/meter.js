// عدّاد الاستخدام وسقف الإنفاق. يقيس التكلفة الفعلية من response.usage، ويمنع تجاوز:
// - سقف يومي للمنصة كلها بالدولار (MOHAKI_AI_DAILY_BUDGET_USD، الافتراضي 5)
// - سقف يومي لعدد الاستدعاءات لكل مستخدم (MOHAKI_AI_USER_DAILY_CALLS، الافتراضي 150)
// عند التجاوز يرفض الطلب، فيكمل المتصفح بالوضع المحلي تلقائيًا.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { costOf } from './pricing.js';

export class BudgetError extends Error {
  constructor(message) { super(message); this.code = 'budget'; }
}

export function createMeter({ dir = null, env = process.env, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const budget = Number(env.MOHAKI_AI_DAILY_BUDGET_USD ?? 5);
  const userCap = Number(env.MOHAKI_AI_USER_DAILY_CALLS ?? 150);
  if (dir) mkdirSync(dir, { recursive: true });
  let day = null;
  let data = null;

  const file = (d) => dir && join(dir, `${d}.json`);
  function load() {
    const d = today();
    if (day === d) return data;
    day = d;
    data = (dir && existsSync(file(d)) && JSON.parse(readFileSync(file(d), 'utf8'))) || { day: d, costUsd: 0, calls: 0, byRoute: {}, users: {} };
    return data;
  }
  function save() {
    if (!dir) return;
    writeFileSync(`${file(day)}.tmp`, JSON.stringify(data, null, 1));
    renameSync(`${file(day)}.tmp`, file(day));
  }

  return {
    limits: { budget, userCap },
    /** يرمي BudgetError إذا تجاوز اليوم سقف المنصة أو سقف المستخدم. */
    check(userKey) {
      const d = load();
      if (d.costUsd >= budget) throw new BudgetError('بلغت المنصة سقف الإنفاق اليومي على الذكاء الاصطناعي');
      if ((d.users[userKey] ?? 0) >= userCap) throw new BudgetError('بلغت الحد اليومي لاستدعاءات الذكاء الاصطناعي');
    },
    record({ userKey, route, model, usage }) {
      const d = load();
      const cost = costOf(model, usage);
      const k = `${route}:${model}`;
      const r = (d.byRoute[k] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 });
      r.calls += 1;
      r.input += usage?.input_tokens ?? 0;
      r.output += usage?.output_tokens ?? 0;
      r.cacheRead += usage?.cache_read_input_tokens ?? 0;
      r.cacheWrite += usage?.cache_creation_input_tokens ?? 0;
      r.costUsd += cost;
      d.calls += 1;
      d.costUsd += cost;
      d.users[userKey] = (d.users[userKey] ?? 0) + 1;
      save();
      return cost;
    },
    report() {
      const d = load();
      return { ...d, users: Object.keys(d.users).length, budgetUsd: budget, userDailyCalls: userCap };
    },
  };
}
