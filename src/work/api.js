// مكتبة الأعمال الواقعية: فرص عمل حقيقية من جهات حقيقية (مدفوعة أو مجانية) تُفتح للمتدرب بعد تقدمه في المحاكاة.
// أمثلة: التواصل مع عملاء، اختبار تجربة مستخدم لموقع، تقرير، ملف إكسل، تسويق، العمل على قضية أو عقد.
//
// المبادئ:
// - تُفتح الفرصة بعد إثبات الجاهزية في المحاكاة (أيام عمل مكتملة، ونقاط عند الحاجة) يحسبها الخادم بإعادة التشغيل.
// - المراجع (المُيسِّر أو ممثل الجهة) هو من يعتمد العمل ويقيّمه. نقاط الإنجاز الواقعي مسار منفصل عن نقاط المحاكاة.
// - التسليم لا يراه إلا المراجع والمُيسِّر. وبيانات تواصل الجهة لا تظهر للمتدرب.
// - الدفع (إن وُجد) اتفاق بين الجهة والمتدرب خارج المنصة، والمنصة تسجّل حالته فقط.
import { randomUUID } from 'node:crypto';
import { replay } from '../replay.js';
import { computePoints } from '../points.js';
import { HttpError } from '../accounts/api.js';
import { firstName } from '../showcase/api.js';

export const KINDS = {
  customers: 'التواصل مع عملاء',
  ux: 'اختبار تجربة مستخدم',
  report: 'تقرير',
  excel: 'ملف إكسل وتحليل بيانات',
  marketing: 'تسويق',
  legal: 'قضية أو عقد',
  sales: 'التواصل مع الجهات لبيع خدماتنا',
  social: 'محتوى إعلاني وإدارة حساباتنا',
  other: 'أخرى',
};
const STATUS = ['pending', 'assigned', 'submitted', 'approved', 'revise', 'rejected', 'withdrawn'];
const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();

export function createWorkApi({ store, world, accountsApi, clock = now }) {
  store.work ??= {};
  const W = store.work;
  W.gigs ??= {}; W.apps ??= {};
  const save = () => store.saveWork?.();
  const requireUser = (req) => { const u = accountsApi.userFrom(req); if (!u) throw new HttpError(401, 'سجّل الدخول أولًا'); return u; };
  const isFac = (u) => accountsApi.isFacilitator(u);
  const requireFac = (req) => { const u = requireUser(req); if (!isFac(u)) throw new HttpError(403, 'للمُيسِّرين فقط'); return u; };
  const canReview = (u, gig) => isFac(u) || (gig.reviewerEmail && u.email === gig.reviewerEmail && !!u.emailVerifiedAt);

  // جاهزية المتدرب من المحاكاة (بإعادة التشغيل، مع ذاكرة مؤقتة)
  const cache = new Map();
  function readiness(uid) {
    const p = store.progress(uid);
    if (!p) return { days: 0, points: 0 };
    const key = `${p.seed}|${p.log.length}|${p.savedAt}`;
    if (cache.get(uid)?.key === key) return cache.get(uid).value;
    let value = { days: 0, points: 0 };
    try {
      const { sim } = replay(world, { ...p, reviews: store.community?.reviews?.[uid] ?? {} });
      const r = sim.report();
      value = { days: r.daysWorked, points: computePoints(r, { finished: sim.finished }).points };
    } catch { /* سجل غير صالح: غير جاهز */ }
    cache.set(uid, { key, value });
    return value;
  }
  const lockReason = (gig, rd) => {
    if (rd.days < (gig.unlock?.minDays ?? 0)) return `تُفتح بعد إكمال ${gig.unlock.minDays} يوم عمل في المحاكاة (أكملت ${rd.days}).`;
    if (rd.points < (gig.unlock?.minPoints ?? 0)) return `تحتاج ${gig.unlock.minPoints} نقطة على الأقل (لديك ${rd.points}).`;
    return null;
  };
  const appsOf = (gigId) => Object.values(W.apps).filter((a) => a.gigId === gigId);
  const taken = (gig) => appsOf(gig.id).filter((a) => ['assigned', 'submitted', 'approved', 'revise'].includes(a.status)).length;
  const earned = (a, gig) => (a.status === 'approved' ? Math.round((gig.points ?? 0) * (a.rating ?? 0) / 5) : 0);

  function gigPublic(g, u, rd) {
    const mine = Object.values(W.apps).find((a) => a.gigId === g.id && a.userId === u.id && a.status !== 'withdrawn');
    return {
      id: g.id, title: g.title, org: g.org, kind: g.kind, kindLabel: KINDS[g.kind], description: g.description, deliverable: g.deliverable,
      link: mine && ['assigned', 'revise', 'submitted', 'approved'].includes(mine.status) ? g.link : null, // الرابط للمكلَّفين فقط
      paid: g.paid, points: g.points, slots: g.slots, left: Math.max(0, g.slots - taken(g)), deadline: g.deadline, status: g.status,
      unlock: g.unlock, locked: lockReason(g, rd), mine: mine && appPublic(mine, g),
      internal: !!g.internal, commission: g.commission ?? null,
    };
  }
  const appPublic = (a, g) => ({ id: a.id, status: a.status, note: a.note, submission: a.submission, feedback: a.feedback, rating: a.rating, earned: earned(a, g), payout: g.paid?.amount ? a.payout ?? 'none' : null, at: a.at, updatedAt: a.updatedAt });

  function list(u) {
    const rd = readiness(u.id);
    const gigs = Object.values(W.gigs).filter((g) => g.status === 'open' || Object.values(W.apps).some((a) => a.gigId === g.id && a.userId === u.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((g) => gigPublic(g, u, rd));
    return { readiness: rd, gigs, summary: summary(u.id), reviewer: isFac(u) || Object.values(W.gigs).some((g) => canReview(u, g)), facilitator: isFac(u) };
  }

  /** ملخص الأعمال الواقعية المعتمدة: يظهر في التقرير وملف الأعمال والسجل الموثّق. */
  function summary(uid) {
    const done = Object.values(W.apps).filter((a) => a.userId === uid && a.status === 'approved');
    const items = done.map((a) => { const g = W.gigs[a.gigId]; return { title: g.title, org: g.org, kind: KINDS[g.kind], rating: a.rating, points: earned(a, g), at: a.updatedAt }; });
    return { count: items.length, points: items.reduce((s, x) => s + x.points, 0), items };
  }

  function createGig(fac, b) {
    const title = str(b.title, 120); const org = str(b.org, 120);
    if (title.length < 4 || org.length < 2) throw new HttpError(400, 'العنوان والجهة مطلوبان');
    if (!KINDS[b.kind]) throw new HttpError(400, 'اختر نوع العمل');
    const amount = Math.max(0, Math.round(Number(b.paid?.amount ?? b.amount) || 0));
    const g = {
      id: randomUUID(), title, org, kind: b.kind,
      description: str(b.description, 3000), deliverable: str(b.deliverable, 1500), link: str(b.link, 400),
      paid: amount ? { amount, currency: 'SAR' } : null,
      points: Math.min(200, Math.max(10, Math.round(Number(b.points) || 50))),
      slots: Math.min(50, Math.max(1, Math.round(Number(b.slots) || 1))),
      deadline: Number.isNaN(Date.parse(b.deadline)) ? null : new Date(b.deadline).toISOString(),
      unlock: { minDays: Math.min(30, Math.max(0, Math.round(Number(b.minDays ?? 10)))), minPoints: Math.min(1000, Math.max(0, Math.round(Number(b.minPoints) || 0))) },
      reviewerEmail: str(b.reviewerEmail, 120).toLowerCase() || null,
      // مشروع داخلي لمحاكي: كل تواصل أو منشور يُرسَل مسودة، ولا يخرج إلا بعد اعتماد المشرف
      internal: b.internal === true || b.internal === 'on',
      commission: str(b.commission, 120) || null,
      status: 'open', createdBy: fac.id, createdAt: clock(),
    };
    W.gigs[g.id] = g;
    save();
    return g;
  }

  function apply(u, gigId, body) {
    const g = W.gigs[gigId];
    if (!g || g.status !== 'open') throw new HttpError(404, 'الفرصة غير متاحة');
    if (!u.emailVerifiedAt) throw new HttpError(403, 'أكّد بريدك أولًا');
    const reason = lockReason(g, readiness(u.id));
    if (reason) throw new HttpError(403, reason);
    if (Object.values(W.apps).some((a) => a.gigId === g.id && a.userId === u.id && a.status !== 'withdrawn')) throw new HttpError(409, 'تقدمت لهذه الفرصة من قبل');
    if (taken(g) >= g.slots) throw new HttpError(409, 'اكتملت المقاعد');
    if (g.deadline && Date.parse(clock()) > Date.parse(g.deadline)) throw new HttpError(409, 'انتهى موعد الفرصة');
    const a = { id: randomUUID(), gigId: g.id, userId: u.id, status: 'pending', note: str(body.note, 800), at: clock(), updatedAt: clock() };
    W.apps[a.id] = a;
    save();
    return appPublic(a, g);
  }

  function submit(u, appId, body) {
    const a = W.apps[appId];
    if (!a || a.userId !== u.id) throw new HttpError(404, 'لا يوجد تكليف بهذا المعرّف');
    if (!['assigned', 'revise'].includes(a.status)) throw new HttpError(409, 'لا يمكن التسليم في هذه المرحلة');
    const text = str(body.text, 8000); const link = str(body.link, 400);
    if (text.length < 40 && !link) throw new HttpError(400, 'اكتب ملخص ما أنجزته (40 حرفًا على الأقل) أو أرفق رابط العمل');
    a.submission = { text, link, at: clock() };
    a.status = 'submitted'; a.updatedAt = clock();
    save();
    return appPublic(a, W.gigs[a.gigId]);
  }

  function decide(u, appId, body) {
    const a = W.apps[appId];
    const g = a && W.gigs[a.gigId];
    if (!a || !canReview(u, g)) throw new HttpError(404, 'لا يوجد طلب بهذا المعرّف');
    const action = body.action;
    const allowed = { accept: ['pending'], reject: ['pending', 'submitted'], approve: ['submitted'], revise: ['submitted'], paid: ['approved'] };
    if (!allowed[action]?.includes(a.status)) throw new HttpError(409, 'إجراء غير متاح في هذه المرحلة');
    if (action === 'accept' && taken(g) >= g.slots) throw new HttpError(409, 'اكتملت المقاعد');
    if (action === 'approve') {
      const rating = Math.round(Number(body.rating));
      if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'قيّم العمل من 1 إلى 5');
      a.rating = rating;
    }
    if (['approve', 'revise', 'reject'].includes(action)) a.feedback = str(body.feedback, 1500);
    if (action === 'paid') { if (!g.paid) throw new HttpError(400, 'الفرصة غير مدفوعة'); a.payout = 'paid'; }
    else a.status = { accept: 'assigned', reject: 'rejected', approve: 'approved', revise: 'revise' }[action];
    if (action === 'approve' && g.paid) a.payout = 'due';
    a.reviewedBy = u.id; a.updatedAt = clock();
    save();
    return { ok: true, status: a.status };
  }

  function reviewQueue(u) {
    return Object.values(W.apps)
      .filter((a) => W.gigs[a.gigId] && canReview(u, W.gigs[a.gigId]) && a.status !== 'withdrawn')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((a) => { const g = W.gigs[a.gigId]; const t = store.users[a.userId]; const rd = readiness(a.userId);
        return { ...appPublic(a, g), gig: { id: g.id, title: g.title, org: g.org, kindLabel: KINDS[g.kind], paid: g.paid, internal: !!g.internal }, trainee: { name: t?.name ?? '—', days: rd.days, points: rd.points } }; });
  }

  const routes = {
    'GET /api/work': (req) => list(requireUser(req)),
    'POST /api/work': (req, body) => ({ gig: createGig(requireFac(req), body) }),
    'POST /api/work/:id/close': (req, body, id) => { requireFac(req); const g = W.gigs[id]; if (!g) throw new HttpError(404, 'غير موجودة'); g.status = 'closed'; save(); return { ok: true }; },
    'POST /api/work/:id/apply': (req, body, id) => ({ application: apply(requireUser(req), id, body) }),
    'POST /api/work/apps/:id/submit': (req, body, id) => ({ application: submit(requireUser(req), id, body) }),
    'POST /api/work/apps/:id/withdraw': (req, body, id) => {
      const u = requireUser(req); const a = W.apps[id];
      if (!a || a.userId !== u.id || ['approved', 'rejected'].includes(a.status)) throw new HttpError(404, 'لا يمكن الانسحاب');
      a.status = 'withdrawn'; a.updatedAt = clock(); save(); return { ok: true };
    },
    'GET /api/work/review': (req) => ({ applications: reviewQueue(requireUser(req)) }),
    'POST /api/work/apps/:id/decide': (req, body, id) => decide(requireUser(req), id, body),
    'GET /api/work/summary': (req) => summary(requireUser(req).id),
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
        for await (const chunk of req) { raw += chunk; if (raw.length > 60_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      send(200, await routes[match[0]](req, body, ...match[1]));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  handle.summary = summary;
  return handle;
}
