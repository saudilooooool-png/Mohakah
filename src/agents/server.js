// واجهة الوكلاء على الخادم: /api/agents/status و /api/meeting/turn
// مواصفات الاجتماع والخيارات تُقرأ من ملفات السيناريو على الخادم، لا مما يرسله المتصفح.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeMeetingTurn, claudeColleagueReply, createClaudeClient, AgentError } from './claude.js';
import { MAX_MESSAGE_CHARS } from './meeting.js';
import { knowledgeFor, canMessage, MAX_COLLEAGUE_MESSAGE } from './colleague.js';
import { resolveRoutes, ROUTES } from './profiles.js';
import { createMeter, BudgetError } from './meter.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/** يقبل من لقطة الحالة القادمة من المتصفح الحقول المعروفة فقط. */
export function cleanContext(raw = {}) {
  const trust = {};
  for (const [k, v] of Object.entries(raw.trust ?? {}).slice(0, 20)) if (/^[a-z_]{1,24}$/.test(k) && num(v) !== undefined) trust[k] = num(v);
  const fields = ['day', 'mrr', 'customers', 'cash', 'runwayMonths', 'productQuality', 'avgHealth', 'supportBacklog', 'morale', 'keyAccountsActive', 'seatPrice', 'marketingBudget'];
  const out = Object.fromEntries(fields.map((f) => [f, num(raw[f])]).filter(([, v]) => v !== undefined));
  out.trust = trust;
  const r = raw.roadmap ?? {};
  out.roadmap = {
    active: str(r.active),
    queue: (Array.isArray(r.queue) ? r.queue : []).slice(0, 8).map((x) => str(x)).filter(Boolean),
    shipped: (Array.isArray(r.shipped) ? r.shipped : []).slice(0, 8).map((x) => str(x)).filter(Boolean),
  };
  out.features = Object.fromEntries(Object.entries(raw.features ?? {}).slice(0, 10)
    .map(([k, v]) => [str(k, 40), num(v)]).filter(([k, v]) => k && v !== undefined));
  out.accountsAtRisk = (Array.isArray(raw.accountsAtRisk) ? raw.accountsAtRisk : []).slice(0, 8).map((x) => str(x)).filter(Boolean);
  out.competitors = (Array.isArray(raw.competitors) ? raw.competitors : []).slice(0, 5)
    .map((c) => ({ name: str(c?.name, 40), seatPrice: num(c?.seatPrice) })).filter((c) => c.name && c.seatPrice !== undefined);
  out.recentDecisions = (Array.isArray(raw.recentDecisions) ? raw.recentDecisions : []).slice(0, 10).map((x) => str(x, 200)).filter(Boolean);
  return out;
}

function cleanMeeting(raw, spec) {
  const allowed = new Set([...spec.participants, 'trainee']);
  const transcript = (Array.isArray(raw?.transcript) ? raw.transcript : []).slice(0, 40)
    .filter((l) => l && allowed.has(l.speaker) && typeof l.text === 'string')
    .map((l) => ({ speaker: l.speaker, text: l.text.slice(0, MAX_MESSAGE_CHARS) }));
  const addressed = Object.fromEntries(spec.concerns.map((c) => [c.id, raw?.addressed?.[c.id] === true]));
  const maxRounds = spec.maxRounds ?? 3;
  const round = Math.max(0, Math.min(maxRounds, Number(raw?.round) || 0));
  return { transcript, addressed, round, maxRounds };
}

export function createAgentApi({
  root, env = process.env, client = createClaudeClient(env), turn = claudeMeetingTurn, colleagueTurn = claudeColleagueReply,
  meter = createMeter({ env }),
  // من يطلب؟ يُستبدل في الخادم بقراءة جلسة الحساب. الضيف لا يستدعي Claude إلا إذا سُمح بذلك.
  identify = () => ({ userKey: 'anonymous', isGuest: true }),
}) {
  const company = JSON.parse(readFileSync(join(root, 'data/companies/nova-tech.json'), 'utf8'));
  const scenario = JSON.parse(readFileSync(join(root, 'data/scenarios/pm-first-30-days.json'), 'utf8'));
  // MOHAKI_AGENT_MODEL (قديم) يفرض نموذجًا واحدًا لكل المسارات إن عُيّن
  const { profile, routes } = resolveRoutes(env.MOHAKI_AGENT_MODEL && !env.MOHAKI_AI_PROFILE
    ? { ...env, MOHAKI_MODEL_MEETING: env.MOHAKI_AGENT_MODEL, MOHAKI_MODEL_CHAT: env.MOHAKI_AGENT_MODEL, MOHAKI_MODEL_COLLEAGUE: env.MOHAKI_AGENT_MODEL }
    : env);
  const guestsUseAi = env.MOHAKI_AI_GUESTS === 'claude';
  const adminToken = env.MOHAKI_ADMIN_TOKEN || null;

  /** المسار متاح عبر Claude لهذا الطالب؟ */
  const online = (route, who) => !!client && routes[route].model !== 'offline' && (!who.isGuest || guestsUseAi);

  const status = (req) => {
    const who = identify(req);
    const r = Object.fromEntries(ROUTES.map((k) => [k, online(k, who) ? 'claude' : 'offline']));
    return { mode: Object.values(r).includes('claude') ? 'claude' : 'offline', profile, routes: r };
  };

  /** ينفذ استدعاءً عبر Claude ضمن سقف الإنفاق، ويسجل التكلفة الفعلية. */
  async function metered(route, req, call) {
    const who = identify(req);
    if (!online(route, who)) throw new AgentError('هذا المسار يعمل بالوضع المحلي', 'offline');
    try { meter.check(who.userKey); } catch (err) { if (err instanceof BudgetError) throw new AgentError(err.message, 'budget'); throw err; }
    const cfg = routes[route];
    const { usage, ...result } = await call(cfg);
    meter.record({ userKey: who.userKey, route, model: result.model || cfg.model, usage });
    return result;
  }

  async function meetingTurn(body, req) {
    const def = [...scenario.events, ...(scenario.randomEvents ?? [])].find((e) => e.id === body?.eventId && e.dialogue);
    if (!def) throw new AgentError('اجتماع غير معروف', 'bad_request');
    const closing = body.closing === true;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!closing && !message) throw new AgentError('الرسالة فارغة', 'bad_request');
    if (message.length > MAX_MESSAGE_CHARS) throw new AgentError('الرسالة أطول من المسموح', 'bad_request');
    const route = def.dialogue.mode === 'chat' ? 'chat' : 'meeting';
    return metered(route, req, (cfg) => turn(client, {
      spec: def.dialogue,
      options: def.options.map((o) => ({ id: o.id, label: o.label })),
      people: company.people,
      saudiContext: company.saudiContext ?? null,
      context: cleanContext(body.context),
      meeting: cleanMeeting(body.meeting, def.dialogue),
      message,
      closing,
      model: cfg.model,
      effort: cfg.effort,
    }));
  }

  async function colleagueReply(body, req) {
    const person = company.people.find((p) => p.id === body?.personId);
    if (!canMessage(person)) throw new AgentError('لا يمكن مراسلة هذا الشخص', 'bad_request');
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new AgentError('الرسالة فارغة', 'bad_request');
    if (message.length > MAX_COLLEAGUE_MESSAGE) throw new AgentError('الرسالة أطول من المسموح', 'bad_request');
    const context = cleanContext(body.context);
    const day = Math.max(1, Math.min(scenario.lengthDays, Number(context.day) || 1));
    const thread = (Array.isArray(body.thread) ? body.thread : []).slice(-12)
      .filter((m) => m && ['trainee', person.id].includes(m.speaker) && typeof m.text === 'string')
      .map((m) => ({ speaker: m.speaker, text: m.text.slice(0, MAX_COLLEAGUE_MESSAGE) }));
    return metered('colleague', req, (cfg) => colleagueTurn(client, {
      person, people: company.people, knowledge: knowledgeFor(person, context, day),
      context, thread, message, saudiContext: company.saudiContext ?? null, model: cfg.model, effort: cfg.effort,
    }));
  }

  /** معالج HTTP. يعيد true إذا عالج الطلب. */
  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (path === '/api/agents/status' && req.method === 'GET') { send(200, status(req)); return true; }
    if (path === '/api/admin/usage' && req.method === 'GET') {
      if (!adminToken || req.headers?.authorization !== `Bearer ${adminToken}`) { send(401, { error: 'غير مصرح' }); return true; }
      send(200, { profile, routes, guestsUseAi, ...meter.report() });
      return true;
    }
    const handlers = { '/api/meeting/turn': meetingTurn, '/api/colleague/reply': colleagueReply };
    if (handlers[path] && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100_000) { send(413, { error: 'الطلب كبير جدًا' }); return true; }
      }
      try {
        send(200, await handlers[path](JSON.parse(raw || '{}'), req));
      } catch (err) {
        const code = err instanceof AgentError ? ({ bad_request: 400, budget: 429, offline: 409 }[err.code] ?? 502) : 500;
        if (!(err instanceof AgentError)) console.error(err);
        send(code, { error: err.message, code: err.code ?? 'internal' });
      }
      return true;
    }
    return false;
  };
}
