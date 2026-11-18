// جلسة التقييم القصيرة للشركات: «يوم عمل تجريبي بدل المقابلة».
//
// - المُيسِّر ينشئ تقييمًا لشركة ويضيف مرشحيها. لكل مرشح رابط خاص، ولا يحتاج حسابًا.
// - كل مرشحي التقييم الواحد يواجهون العالم نفسه (بذرة واحدة)، فالمقارنة عادلة.
// - تقدم المرشح يُحفظ هنا لا في حسابات المتدربين، والنتيجة يحسبها الخادم بإعادة التشغيل.
// - الشركة تفتح تقرير المقارنة برابط سري، دون حساب. المرشح لا يرى نقاطه.
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { replay } from '../replay.js';
import { computePoints } from '../points.js';
import { HttpError } from '../accounts/api.js';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();
const token = () => randomBytes(12).toString('hex');
const MAX_LOG = 400;

export const ROLES = {
  pm: { label: 'مدير منتجات (مبتدئ)', as: 'مديرًا للمنتجات' },
  sales: { label: 'أخصائي مبيعات', as: 'أخصائيًا للمبيعات' },
  cs: { label: 'أخصائي نجاح العملاء وخدمتهم', as: 'أخصائيًا لنجاح العملاء' },
};

export function createAssessApi({ store, worlds, accountsApi, mailer = null, env = process.env, clock = now }) {
  store.assess ??= {};
  const A = store.assess;
  A.assessments ??= {};
  const save = () => store.saveAssess?.();
  const base = (env.MOHAKI_PUBLIC_URL || 'http://localhost:4173').replace(/\/$/, '');
  const requireFac = (req) => { const u = accountsApi.userFrom(req); if (!u || !accountsApi.isFacilitator(u)) throw new HttpError(403, 'للمُيسِّرين فقط'); return u; };
  const all = () => Object.values(A.assessments);
  const worldOf = (a) => worlds[a.role ?? 'pm'];
  const findCandidate = (t) => { for (const a of all()) { const c = a.candidates.find((x) => x.token === t); if (c) return [a, c]; } throw new HttpError(404, 'رابط التقييم غير صالح'); };
  const hasToken = (t) => all().some((a) => a.candidates.some((c) => c.token === t));

  function addCandidates(a, list) {
    const added = [];
    for (const raw of (Array.isArray(list) ? list : []).slice(0, 200)) {
      const name = str(raw.name, 80);
      if (name.length < 2) continue;
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str(raw.email, 120)) ? str(raw.email, 120).toLowerCase() : '';
      const c = { token: token(), name, email, invitedAt: clock(), startedAt: null, finishedAt: null, progress: null };
      a.candidates.push(c); added.push(c);
    }
    return added;
  }

  async function invite(a, c) {
    if (!mailer || !c.email) return;
    const link = `${base}/a/${c.token}`;
    try {
      await mailer.send({ to: c.email, subject: `${a.company}: دعوة إلى يوم عمل تجريبي`, link,
        text: `مرحبًا ${c.name}،\n\nتدعوك ${a.company} إلى جلسة تقييم عملية (${a.title}) على منصة محاكي: تعمل ثلاثة أيام عمل مكثفة ${ROLES[a.role ?? 'pm'].as} في شركة افتراضية، في نحو ${a.minutes} دقيقة، في الوقت الذي يناسبك.\n\nرابطك الخاص: ${link}\n\nلا يحتاج الرابط حسابًا ولا تثبيتًا. لا تشاركه مع أحد.` });
    } catch (err) { console.error('تعذر إرسال دعوة التقييم', err.message); }
  }

  function create(fac, body) {
    const role = ROLES[body.role] ? body.role : 'pm';
    const title = str(body.title, 100) || ROLES[role].label;
    const company = str(body.company, 100);
    if (company.length < 2) throw new HttpError(400, 'اسم الشركة مطلوب');
    const a = { id: randomUUID(), role, title, company, seed: randomInt(1, 1_000_000), reportToken: token(), minutes: Math.min(240, Math.max(30, Math.round(Number(body.minutes) || 120))), createdBy: fac.id, createdAt: clock(), candidates: [] };
    const added = addCandidates(a, body.candidates);
    if (!added.length) throw new HttpError(400, 'أضف مرشحًا واحدًا على الأقل');
    A.assessments[a.id] = a;
    save();
    added.forEach((c) => invite(a, c));
    return a;
  }

  const status = (c) => (c.finishedAt ? 'finished' : c.startedAt ? 'started' : 'invited');
  const facView = (a) => ({
    id: a.id, role: a.role ?? 'pm', roleLabel: ROLES[a.role ?? 'pm'].label, title: a.title, company: a.company, minutes: a.minutes, createdAt: a.createdAt,
    reportLink: `${base}/r/${a.reportToken}`,
    candidates: a.candidates.map((c) => ({ name: c.name, email: c.email, status: status(c), link: `${base}/a/${c.token}` })),
  });

  function candidateView(a, c) {
    return { title: a.title, company: a.company, role: a.role ?? 'pm', roleAs: ROLES[a.role ?? 'pm'].as, scenario: `${a.role ?? 'pm'}-assessment`, name: c.name, seed: a.seed, minutes: a.minutes, startedAt: c.startedAt, finished: !!c.finishedAt, progress: c.finishedAt ? null : c.progress };
  }

  function saveProgress(t, body) {
    const [a, c] = findCandidate(t);
    if (!c.startedAt) throw new HttpError(409, 'ابدأ الجلسة أولًا');
    if (c.finishedAt) throw new HttpError(409, 'انتهت الجلسة وسُلّمت. لا يمكن التعديل.');
    if (!Array.isArray(body.log) || body.log.length > MAX_LOG) throw new HttpError(400, 'سجل أفعال غير صالح');
    if ((c.progress?.log.length ?? 0) > body.log.length) throw new HttpError(409, 'نسخة أقدم من المحفوظة');
    let sim;
    try { ({ sim } = replay(worldOf(a), { seed: a.seed, log: body.log }, { strict: true })); } catch (err) { throw new HttpError(422, `سجل غير صالح: ${err.message}`); }
    const clip = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, 200).map(([k, v]) => [String(k).slice(0, 80), Number(v) || 0])) : {});
    c.progress = { seed: a.seed, startedAt: c.startedAt, log: body.log, threads: body.threads && typeof body.threads === 'object' ? body.threads : {}, read: clip(body.read), opened: clip(body.opened), savedAt: clock() };
    if (sim.finished) c.finishedAt = clock();
    save();
    return { ok: true, finished: !!c.finishedAt };
  }

  /** تقرير المقارنة للشركة: يُحسب بإعادة تشغيل أفعال كل مرشح. */
  function report(reportToken) {
    const a = all().find((x) => x.reportToken === reportToken);
    if (!a) throw new HttpError(404, 'رابط التقرير غير صالح');
    const world = worldOf(a);
    const rows = a.candidates.map((c) => {
      const row = { name: c.name, status: status(c), startedAt: c.startedAt, finishedAt: c.finishedAt, minutes: c.startedAt && c.finishedAt ? Math.max(1, Math.round((Date.parse(c.finishedAt) - Date.parse(c.startedAt)) / 60000)) : null };
      if (!c.progress) return row;
      let sim;
      try { ({ sim } = replay(world, c.progress)); } catch { return row; }
      const r = sim.report();
      const pts = computePoints(r, { finished: sim.finished });
      const itemOf = (id) => sim.items.find((i) => i.id === id);
      const { you, baselineNoActions: b } = r.companyOutcome;
      return {
        ...row, day: Math.min(sim.day, sim.lastDay), points: pts.points, band: pts.band.label,
        skills: r.skills.filter((s) => s.score !== null).map((s) => ({ label: s.label, score: s.score })),
        strengths: r.strengths, toImprove: r.toImprove,
        missed: r.evidence.itemsMissed,
        impact: { mrr: Math.round(you.mrr - b.mrr), health: you.avgHealth - b.avgHealth },
        decisions: sim.actions.filter((x) => x.kind === 'decision').map((x) => {
          const it = itemOf(x.itemId); const opt = it?.options.find((o) => o.id === x.optionId);
          return { day: x.day, title: it?.title, choice: opt?.label, quality: x.quality, addressed: x.addressed?.length ?? null, concerns: x.concernsTotal ?? null,
            said: (x.transcript ?? []).filter((l) => l.speaker === 'trainee').map((l) => l.text), rationale: x.transcript ? '' : x.rationale };
        }),
        deliverables: sim.actions.filter((x) => x.kind === 'deliverable').map((x) => ({ title: itemOf(x.itemId)?.title, score: Math.round(x.evaluation.score * 100), covered: x.evaluation.sections.filter((s) => s.covered).map((s) => s.label), missing: x.evaluation.sections.filter((s) => !s.covered).map((s) => s.label), text: x.text })),
      };
    }).sort((x, y) => (y.points ?? -1) - (x.points ?? -1));
    return { title: a.title, company: a.company, createdAt: a.createdAt, minutes: a.minutes, role: world.scenario.role, days: world.scenario.lengthDays, candidates: rows,
      summary: { invited: rows.length, started: rows.filter((r) => r.status !== 'invited').length, finished: rows.filter((r) => r.status === 'finished').length } };
  }

  const routes = {
    'GET /api/assess': (req) => { requireFac(req); return { assessments: all().sort((x, y) => y.createdAt.localeCompare(x.createdAt)).map(facView) }; },
    'POST /api/assess': (req, body) => ({ assessment: facView(create(requireFac(req), body)) }),
    'POST /api/assess/:id/candidates': (req, body, id) => {
      requireFac(req); const a = A.assessments[id]; if (!a) throw new HttpError(404, 'لا يوجد تقييم');
      const added = addCandidates(a, body.candidates); save(); added.forEach((c) => invite(a, c));
      return { assessment: facView(a) };
    },
    'GET /api/assess/c/:token': (req, body, t) => { const [a, c] = findCandidate(t); return { assessment: candidateView(a, c) }; },
    'POST /api/assess/c/:token/start': (req, body, t) => {
      const [a, c] = findCandidate(t);
      if (body.consent !== true) throw new HttpError(400, 'نحتاج موافقتك على معالجة إجاباتك ومشاركة نتيجتك مع الشركة');
      if (!c.startedAt) { c.startedAt = clock(); c.consentAt = clock(); save(); }
      return { assessment: candidateView(a, c) };
    },
    'PUT /api/assess/c/:token/progress': (req, body, t) => saveProgress(t, body),
    'GET /api/assess/report/:token': (req, body, t) => ({ report: report(t) }),
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const short = url.pathname.match(/^\/([ar])\/([a-f0-9]{24})$/);
    if (req.method === 'GET' && short) { res.writeHead(302, { Location: `/app/#/${short[1] === 'a' ? 'assess' : 'assess-report'}/${short[2]}` }); res.end(); return true; }
    const match = Object.keys(routes).map((k) => {
      const [m, path] = k.split(' ');
      if (m !== req.method) return null;
      const r = url.pathname.match(new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`));
      return r ? [k, r.slice(1).map(decodeURIComponent)] : null;
    }).find(Boolean);
    if (!match) return false;
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      let body = {};
      if (req.method !== 'GET') {
        if (!String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 600_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      send(200, await routes[match[0]](req, body, ...match[1]));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  handle.hasToken = hasToken;
  return handle;
}
