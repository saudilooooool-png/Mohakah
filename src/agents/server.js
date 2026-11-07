// واجهة الوكلاء على الخادم: /api/agents/status و /api/meeting/turn
// مواصفات الاجتماع والخيارات تُقرأ من ملفات السيناريو على الخادم، لا مما يرسله المتصفح.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeMeetingTurn, createClaudeClient, AgentError, DEFAULT_MODEL } from './claude.js';
import { MAX_MESSAGE_CHARS } from './meeting.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/** يقبل من لقطة الحالة القادمة من المتصفح الحقول المعروفة فقط. */
export function cleanContext(raw = {}) {
  const trust = {};
  for (const [k, v] of Object.entries(raw.trust ?? {}).slice(0, 20)) if (/^[a-z_]{1,24}$/.test(k) && num(v) !== undefined) trust[k] = num(v);
  const fields = ['day', 'mrr', 'customers', 'cash', 'runwayMonths', 'productQuality', 'avgHealth', 'supportBacklog', 'morale', 'keyAccountsActive'];
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

export function createAgentApi({ root, env = process.env, client = createClaudeClient(env), turn = claudeMeetingTurn }) {
  const company = JSON.parse(readFileSync(join(root, 'data/companies/nova-tech.json'), 'utf8'));
  const scenario = JSON.parse(readFileSync(join(root, 'data/scenarios/pm-first-30-days.json'), 'utf8'));
  const model = env.MOHAKI_AGENT_MODEL || DEFAULT_MODEL;

  const status = () => ({ mode: client ? 'claude' : 'offline', model: client ? model : null });

  async function meetingTurn(body) {
    if (!client) throw new AgentError('وكلاء Claude غير مفعّلين على هذا الخادم', 'offline');
    const def = scenario.events.find((e) => e.id === body?.eventId && e.dialogue);
    if (!def) throw new AgentError('اجتماع غير معروف', 'bad_request');
    const closing = body.closing === true;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!closing && !message) throw new AgentError('الرسالة فارغة', 'bad_request');
    if (message.length > MAX_MESSAGE_CHARS) throw new AgentError('الرسالة أطول من المسموح', 'bad_request');
    return turn(client, {
      spec: def.dialogue,
      options: def.options.map((o) => ({ id: o.id, label: o.label })),
      people: company.people,
      context: cleanContext(body.context),
      meeting: cleanMeeting(body.meeting, def.dialogue),
      message,
      closing,
      model,
    });
  }

  /** معالج HTTP. يعيد true إذا عالج الطلب. */
  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (path === '/api/agents/status' && req.method === 'GET') { send(200, status()); return true; }
    if (path === '/api/meeting/turn' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 100_000) { send(413, { error: 'الطلب كبير جدًا' }); return true; }
      }
      try {
        send(200, await meetingTurn(JSON.parse(raw || '{}')));
      } catch (err) {
        const code = err instanceof AgentError ? (err.code === 'bad_request' ? 400 : 502) : 500;
        if (!(err instanceof AgentError)) console.error(err);
        send(code, { error: err.message, code: err.code ?? 'internal' });
      }
      return true;
    }
    return false;
  };
}
