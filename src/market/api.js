// بحث السوق الحقيقي بتطابق الإجابات: السؤال نفسه يُعطى لعدة متدربين، وكل واحد يبحث ويرفق مصدره.
// إذا تطابقت إجابات الأغلبية اعتُمد الجواب وأخذ أصحابه نقاطًا.
//
// الضوابط:
// - لا يرى المتدرب إجابات غيره قبل أن يجيب.
// - كل إجابة بمصدر (رابط). وإذا جاءت الإجابات المتطابقة كلها من موقع واحد، لا تُعتمد تلقائيًا:
//   تنتظر تأكيد المُيسِّر، لأن الأغلبية قد تنقل الخطأ نفسه.
// - النقاط مسار "أبحاث السوق" المنفصل، ولا تدخل في نقاط المحاكاة الرسمية.
// - الأجوبة المعتمدة قاعدة بيانات سوق تملكها محاكي.
import { randomUUID } from 'node:crypto';
import { HttpError } from '../accounts/api.js';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();
const MIN_ANSWERS = 3;
const AGREE = 0.6;
const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

export function createMarketApi({ store, accountsApi, clock = now }) {
  store.market ??= {};
  const M = store.market;
  M.questions ??= {}; M.answers ??= {};
  const save = () => store.saveMarket?.();
  const requireUser = (req) => { const u = accountsApi.userFrom(req); if (!u) throw new HttpError(401, 'سجّل الدخول أولًا'); return u; };
  const isFac = (u) => accountsApi.isFacilitator(u);
  const requireFac = (req) => { const u = requireUser(req); if (!isFac(u)) throw new HttpError(403, 'للمُيسِّرين فقط'); return u; };
  const daysOf = (uid) => (store.progress(uid)?.log ?? []).filter((a) => a.t === 'endDay').length;
  const answersOf = (qid) => Object.values(M.answers).filter((a) => a.questionId === qid);

  const matches = (q, value, target) => (q.type === 'number'
    ? Math.abs(Number(value) - Number(target)) <= Math.abs(Number(target)) * (q.tolerancePct / 100) + 1e-9
    : String(value) === String(target));

  /** يحسب حالة السؤال من إجاباته: هل تطابقت الأغلبية؟ ومن مصادر مختلفة؟ */
  function evaluate(q) {
    if (q.final) return;
    const list = answersOf(q.id);
    if (list.length < MIN_ANSWERS) { q.status = 'open'; return; }
    let target;
    if (q.type === 'number') {
      const sorted = list.map((a) => Number(a.value)).sort((x, y) => x - y);
      target = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    } else {
      const count = {};
      for (const a of list) count[a.value] = (count[a.value] ?? 0) + 1;
      target = Object.entries(count).sort((x, y) => y[1] - x[1])[0][0];
    }
    const agree = list.filter((a) => matches(q, a.value, target));
    if (agree.length / list.length < AGREE) { q.status = list.length >= q.slots ? 'disputed' : 'open'; q.consensus = null; return; }
    const domains = new Set(agree.map((a) => domainOf(a.sourceUrl)));
    q.consensus = { value: q.type === 'number' ? target : String(target), agree: agree.length, total: list.length, domains: domains.size };
    // أغلبية من موقع واحد = ربما نقل الجميع الخطأ نفسه: تنتظر المُيسِّر
    q.status = domains.size >= 2 ? 'consensus' : 'same_source';
  }
  const settled = (q) => (q.final ? q.final.value : q.status === 'consensus' ? q.consensus.value : null);
  const pointsFor = (q, a) => { const v = settled(q); return v !== null && matches(q, a.value, v) ? q.points : 0; };

  function summary(uid) {
    const mine = Object.values(M.answers).filter((a) => a.userId === uid);
    const scored = mine.map((a) => pointsFor(M.questions[a.questionId], a));
    return { answered: mine.length, confirmed: scored.filter(Boolean).length, points: scored.reduce((x, y) => x + y, 0) };
  }

  function view(q, u) {
    const mine = answersOf(q.id).find((a) => a.userId === u.id);
    const list = answersOf(q.id);
    const v = settled(q);
    const fac = isFac(u);
    const locked = !fac && daysOf(u.id) < q.minDays ? `يُفتح بعد إكمال ${q.minDays} يوم عمل في المحاكاة.` : null;
    return {
      id: q.id, title: q.title, question: q.question, type: q.type, unit: q.unit, options: q.options, points: q.points, slots: q.slots,
      answers: list.length, left: Math.max(0, q.slots - list.length), status: q.status, locked,
      mine: mine && { value: mine.value, sourceUrl: mine.sourceUrl, note: mine.note, points: pointsFor(q, mine), matched: v === null ? null : matches(q, mine.value, v) },
      // النتيجة تظهر لمن أجاب فقط (وللمُيسِّر)، وبعد الحسم
      result: (mine || fac) && v !== null ? { value: v, confirmedBy: q.final ? 'facilitator' : 'consensus' } : null,
      ...(fac ? { consensus: q.consensus ?? null, all: list.map((a) => ({ name: store.users[a.userId]?.name ?? '—', value: a.value, sourceUrl: a.sourceUrl, domain: domainOf(a.sourceUrl), note: a.note })) } : {}),
    };
  }

  function create(fac, b) {
    const title = str(b.title, 120); const question = str(b.question, 1000);
    if (title.length < 4 || question.length < 10) throw new HttpError(400, 'العنوان والسؤال مطلوبان');
    const type = b.type === 'choice' ? 'choice' : 'number';
    const options = type === 'choice' ? String(b.options ?? '').split(/[\n،,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 8) : [];
    if (type === 'choice' && options.length < 2) throw new HttpError(400, 'أضف خيارين على الأقل');
    const q = { id: randomUUID(), title, question, type, options, unit: str(b.unit, 20),
      tolerancePct: Math.min(50, Math.max(0, Number(b.tolerancePct ?? 10) || 0)), points: Math.min(100, Math.max(5, Math.round(Number(b.points) || 20))),
      slots: Math.min(15, Math.max(MIN_ANSWERS, Math.round(Number(b.slots) || 5))), minDays: Math.min(30, Math.max(0, Math.round(Number(b.minDays ?? 5)))),
      status: 'open', consensus: null, final: null, createdBy: fac.id, createdAt: clock() };
    M.questions[q.id] = q;
    save();
    return q;
  }

  function answer(u, id, b) {
    const q = M.questions[id];
    if (!q) throw new HttpError(404, 'لا يوجد سؤال بهذا المعرّف');
    if (!u.emailVerifiedAt) throw new HttpError(403, 'أكّد بريدك أولًا');
    if (daysOf(u.id) < q.minDays) throw new HttpError(403, `يُفتح بعد إكمال ${q.minDays} يوم عمل في المحاكاة.`);
    if (q.final) throw new HttpError(409, 'حُسم هذا السؤال');
    const list = answersOf(id);
    if (list.some((a) => a.userId === u.id)) throw new HttpError(409, 'أجبت عن هذا السؤال من قبل');
    if (list.length >= q.slots) throw new HttpError(409, 'اكتمل عدد الباحثين لهذا السؤال');
    let value;
    if (q.type === 'number') { value = Number(b.value); if (!Number.isFinite(value) || String(b.value).trim() === '') throw new HttpError(400, 'أدخل رقمًا'); }
    else { value = str(b.value, 120); if (!q.options.includes(value)) throw new HttpError(400, 'اختر أحد الخيارات'); }
    const sourceUrl = str(b.sourceUrl, 400);
    if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(sourceUrl)) throw new HttpError(400, 'أرفق رابط المصدر الذي وجدت فيه الجواب');
    const a = { id: randomUUID(), questionId: id, userId: u.id, value, sourceUrl, note: str(b.note, 500), at: clock() };
    M.answers[a.id] = a;
    evaluate(q);
    save();
    return view(q, u);
  }

  const routes = {
    'GET /api/market': (req) => {
      const u = requireUser(req);
      const list = Object.values(M.questions).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((q) => view(q, u))
        .filter((q) => isFac(u) || q.mine || (q.left > 0 && q.status !== 'consensus' && !q.result));
      return { questions: list, summary: summary(u.id), facilitator: isFac(u) };
    },
    'POST /api/market': (req, body) => { const f = requireFac(req); return { question: view(create(f, body), f) }; },
    'POST /api/market/:id/answer': (req, body, id) => ({ question: answer(requireUser(req), id, body) }),
    // المُيسِّر يحسم: يؤكد جواب الأغلبية أو يصححه. النقاط لمن طابق الجواب النهائي.
    'POST /api/market/:id/confirm': (req, body, id) => {
      const f = requireFac(req); const q = M.questions[id];
      if (!q) throw new HttpError(404, 'لا يوجد سؤال');
      const value = q.type === 'number' ? Number(body.value) : str(body.value, 120);
      if (q.type === 'number' ? !Number.isFinite(value) : !q.options.includes(value)) throw new HttpError(400, 'أدخل الجواب النهائي');
      q.final = { value, by: f.id, at: clock() }; q.status = 'confirmed';
      save();
      return { question: view(q, f) };
    },
    'GET /api/market/summary': (req) => summary(requireUser(req).id),
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
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
      if (req.method === 'POST') {
        if (!String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      send(200, await routes[match[0]](req, body, ...match[1]));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  return handle;
}
