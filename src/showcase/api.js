// العرض والتسويق الذاتي: "تحداني على نفس الشركة"، وملف الأعمال الموثّق.
//
// المبدأ: كل ما يُعرض للعامة يُحسب على الخادم بإعادة تشغيل الأفعال بالمحرك الحتمي،
// فلا يمكن تجميله من المتصفح. ولا يظهر للعامة إلا الاسم الأول والنتيجة، ولا بريد ولا بيانات تواصل.
import { randomBytes } from 'node:crypto';
import { replay } from '../replay.js';
import { computePoints } from '../points.js';
import { Simulation } from '../engine/simulation.js';
import { HttpError } from '../accounts/api.js';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (n = 6) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');
export const firstName = (name = '') => String(name).trim().split(/\s+/)[0] || 'متدرب';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createShowcaseApi({ store, world, accountsApi, clock = now }) {
  store.showcase ??= {};
  const S = store.showcase;
  S.challenges ??= {};
  S.portfolios ??= {};
  const save = () => store.saveShowcase?.();
  const requireUser = (req) => { const u = accountsApi.userFrom(req); if (!u) throw new HttpError(401, 'سجّل الدخول أولًا'); return u; };

  // نتيجة متدرب محسوبة بإعادة التشغيل، مع ذاكرة مؤقتة حسب طول السجل
  const cache = new Map();
  function standing(userId) {
    const p = store.progress(userId);
    if (!p) return null;
    const key = `${p.seed}|${p.log.length}|${p.savedAt}`;
    const hit = cache.get(userId);
    if (hit?.key === key) return hit.value;
    let value = null;
    try {
      const { sim } = replay(world, { ...p, reviews: store.community?.reviews?.[userId] ?? {} });
      const report = sim.report();
      const pts = computePoints(report, { finished: sim.finished });
      value = { seed: p.seed, challenge: p.challenge ?? null, points: pts.points, band: pts.band.label, days: report.daysWorked, finished: sim.finished };
    } catch { value = null; }
    cache.set(userId, { key, value });
    return value;
  }

  function createChallenge(u) {
    const st = standing(u.id);
    if (!st || st.days < 1) throw new HttpError(400, 'أكمل يوم عمل واحدًا على الأقل قبل أن تتحدى أحدًا');
    const existing = Object.values(S.challenges).find((c) => c.ownerId === u.id && c.seed === st.seed && !c.revoked);
    if (existing) return existing;
    let c;
    do c = code(); while (S.challenges[c]);
    const ch = { code: c, ownerId: u.id, seed: st.seed, createdAt: clock(), revoked: false, snapshot: { points: st.points, band: st.band, days: st.days, finished: st.finished } };
    S.challenges[c] = ch;
    save();
    return ch;
  }

  /** نتيجة صاحب التحدي: الحالية إن كان ما زال في العالم نفسه، وإلا آخر لقطة محفوظة. */
  function ownerStanding(ch) {
    const st = standing(ch.ownerId);
    if (st && st.seed === ch.seed && !st.challenge) {
      ch.snapshot = { points: st.points, band: st.band, days: st.days, finished: st.finished };
      return ch.snapshot;
    }
    return ch.snapshot;
  }

  function view(ch, viewer) {
    if (!ch || ch.revoked) throw new HttpError(404, 'لا يوجد تحدٍّ بهذا الرمز، أو ألغاه صاحبه');
    const owner = store.users[ch.ownerId];
    const board = [];
    for (const [userId] of store.allProgress()) {
      if (userId === ch.ownerId || !store.users[userId]) continue;
      const st = standing(userId);
      if (!st || st.challenge !== ch.code || st.seed !== ch.seed) continue;
      board.push({ name: firstName(store.users[userId].name), points: st.points, band: st.band, days: st.days, finished: st.finished, you: viewer?.id === userId });
    }
    const o = ownerStanding(ch);
    board.push({ name: firstName(owner?.name), points: o.points, band: o.band, days: o.days, finished: o.finished, owner: true, you: viewer?.id === ch.ownerId });
    board.sort((a, b) => b.points - a.points || b.days - a.days);
    return {
      code: ch.code, seed: ch.seed, createdAt: ch.createdAt, mine: viewer?.id === ch.ownerId,
      owner: { name: firstName(owner?.name), ...o },
      board: board.slice(0, 50), participants: board.length - 1,
      lengthDays: world.scenario.lengthDays, company: world.company.name, role: world.scenario.role,
    };
  }

  /** صفحة HTML صغيرة لمعاينة الرابط في واتساب وX ولينكدإن، ثم تحويل إلى التطبيق. */
  function previewPage(c, origin = '') {
    const ch = S.challenges[c];
    const target = `/app/#/challenge/${encodeURIComponent(c)}`;
    let title = 'تحدٍّ في محاكي: شهر كمدير منتجات في NOVA TECH';
    let desc = 'نفس الشركة ونفس الأحداث. هل تتفوق؟';
    if (ch && !ch.revoked) {
      const o = ownerStanding(ch);
      const name = firstName(store.users[ch.ownerId]?.name);
      // صياغة بلسان صاحب التحدي: محايدة لا تفترض جنسه
      title = o.finished ? `${name}: أنهيت شهري مديرًا للمنتجات بـ${o.points} نقطة. تقدر تتفوق علي؟` : `${name}: ${o.points} نقطة بعد ${o.days} أيام عمل. تقدر تتفوق علي؟`;
      desc = `نفس الشركة (${world.company.name}) ونفس الأحداث بالضبط. 30 يوم عمل، قرارات لها عواقب، واجتماعات مع زملاء يعترضون.`;
    }
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:image" content="${esc(origin)}/app/assets/og-challenge.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body><p><a href="${esc(target)}">${esc(title)}</a></p></body></html>`;
  }

  // ——— ملف الأعمال الموثّق ———
  // المتدرب يختار ما يُعرض، والخادم يولّد المحتوى من إعادة التشغيل: لا نص يكتبه المتدرب إلا العنوان التعريفي.
  const LIMITS = { deliverables: 3, decisions: 5, quotes: 4 };
  const words = (t = '') => t.trim().split(/\s+/).filter(Boolean).length;

  /** كل ما يمكن عرضه من شهر المتدرب، محسوبًا بإعادة التشغيل. */
  function material(userId) {
    const p = store.progress(userId);
    if (!p) return null;
    let sim;
    try { ({ sim } = replay(world, { ...p, reviews: store.community?.reviews?.[userId] ?? {} })); } catch { return null; }
    const report = sim.report();
    const points = computePoints(report, { finished: sim.finished });
    const itemOf = (id) => sim.items.find((i) => i.id === id);
    const deliverables = []; const decisions = []; const quotes = [];
    for (const a of sim.actions) {
      const item = itemOf(a.itemId);
      if (!item) continue;
      if (a.kind === 'deliverable') {
        deliverables.push({ id: a.itemId, day: a.day, title: item.title, score: Math.round(a.evaluation.score * 100), words: words(a.text), covered: a.evaluation.sections.filter((x) => x.covered).map((x) => x.label), text: a.text });
      } else if (a.kind === 'decision') {
        const opt = item.options?.find((o) => o.id === a.optionId);
        decisions.push({ id: a.itemId, day: a.day, title: item.title, choice: opt?.label ?? '', rationale: a.rationale ?? '', dialogue: !!a.transcript, addressed: a.addressed?.length ?? null, concerns: a.concernsTotal ?? null });
        (a.transcript ?? []).forEach((l, i) => {
          if (l.speaker === 'trainee' && words(l.text) >= 8) quotes.push({ id: `${a.itemId}~${i}`, day: a.day, title: item.title, text: l.text });
        });
      }
    }
    const baseline = Simulation.runBaseline(world.company, world.scenario, p.seed, sim.history.length - 1);
    return {
      seed: p.seed, sim, report, points,
      candidates: { deliverables, decisions, quotes },
      series: { you: sim.history.map((h) => h.mrr), baseline: baseline.history.map((h) => h.mrr) },
    };
  }

  const portfolioOf = (userId) => S.portfolios[userId] ?? null;

  function portfolioEditor(u) {
    const m = material(u.id);
    if (!m) throw new HttpError(400, 'ابدأ شهرك أولًا: ملف الأعمال يُبنى من أعمالك داخل المحاكاة');
    const pf = portfolioOf(u.id);
    const strip = (d) => { const { text, ...rest } = d; return { ...rest, excerpt: text.slice(0, 220) }; };
    return {
      portfolio: pf && { slug: pf.slug, published: pf.published, headline: pf.headline, displayName: pf.displayName, selections: pf.selections, updatedAt: pf.updatedAt },
      candidates: { ...m.candidates, deliverables: m.candidates.deliverables.map(strip) },
      limits: LIMITS,
      fullName: u.name, firstName: firstName(u.name),
    };
  }

  function savePortfolio(u, body) {
    const m = material(u.id);
    if (!m) throw new HttpError(400, 'ابدأ شهرك أولًا');
    const pick = (key) => {
      const ids = new Set(m.candidates[key].map((x) => x.id));
      return [...new Set(Array.isArray(body.selections?.[key]) ? body.selections[key] : [])].filter((id) => ids.has(id)).slice(0, LIMITS[key]);
    };
    const selections = { deliverables: pick('deliverables'), decisions: pick('decisions'), quotes: pick('quotes') };
    const prev = portfolioOf(u.id);
    let slug = prev?.slug;
    if (!slug) { do slug = code(8); while (Object.values(S.portfolios).some((x) => x.slug === slug)); }
    const pf = {
      slug, seed: m.seed, selections,
      headline: str(body.headline, 140),
      displayName: body.displayName === 'full' ? 'full' : 'first',
      published: body.published === true,
      createdAt: prev?.createdAt ?? clock(), updatedAt: clock(),
    };
    S.portfolios[u.id] = pf;
    save();
    return portfolioEditor(u);
  }

  function unpublish(u) {
    // حذف الملف كاملًا: الرابط القديم يتوقف نهائيًا، والنشر لاحقًا يعطي رابطًا جديدًا
    delete S.portfolios[u.id];
    save();
    return { ok: true };
  }

  function publicPortfolio(slug) {
    const entry = Object.entries(S.portfolios).find(([, x]) => x.slug === slug && x.published);
    if (!entry) throw new HttpError(404, 'لا يوجد ملف أعمال منشور بهذا الرابط، أو أوقفه صاحبه');
    const [userId, pf] = entry;
    const u = store.users[userId];
    const m = u && material(userId);
    if (!m) throw new HttpError(404, 'ملف الأعمال غير متاح');
    if (m.seed !== pf.seed) throw new HttpError(404, 'بدأ صاحب الملف شهرًا جديدًا، ولم يحدّث ملفه بعد');
    const by = (key) => pf.selections[key].map((id) => m.candidates[key].find((x) => x.id === id)).filter(Boolean);
    const { you, baselineNoActions: base } = m.report.companyOutcome;
    const record = Object.values(store.records).filter((r) => r.userId === userId && !r.revoked).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
    const challenge = Object.values(S.challenges).find((c) => c.ownerId === userId && c.seed === m.seed && !c.revoked);
    return {
      slug, name: pf.displayName === 'full' ? u.name : firstName(u.name), headline: pf.headline,
      role: m.report.role, company: m.report.company, occupation: m.report.occupation && { code: m.report.occupation.code, titleAr: m.report.occupation.titleAr },
      days: m.report.daysWorked, lengthDays: world.scenario.lengthDays, finished: m.sim.finished,
      points: m.points.points, band: m.points.band.label, skills: m.report.skills.filter((x) => x.score !== null).map((x) => ({ label: x.label, score: x.score })),
      strengths: m.report.strengths,
      impact: { mrr: you.mrr, mrrBaseline: base.mrr, customers: you.customers, customersBaseline: base.customers, health: you.avgHealth, healthBaseline: base.avgHealth },
      series: m.series,
      shipped: m.report.evidence.shipped,
      counts: { decisions: m.candidates.decisions.length, deliverables: m.candidates.deliverables.length, dialogues: m.candidates.decisions.filter((d) => d.dialogue).length },
      deliverables: by('deliverables'), decisions: by('decisions'), quotes: by('quotes'),
      record: record ? { code: record.code, points: record.points } : null,
      challenge: challenge?.code ?? null,
      updatedAt: pf.updatedAt,
      verifiedBy: 'server-replay',
    };
  }

  function portfolioPreview(slug, origin) {
    let title = 'ملف أعمال موثّق — محاكي';
    let desc = 'أعمال حقيقية من شهر عمل في شركة افتراضية، تُولَّد من إعادة تشغيل القرارات على الخادم.';
    try {
      const p = publicPortfolio(slug);
      title = `${p.name} · ${p.role} — ${p.points} نقطة | ملف أعمال موثّق`;
      desc = p.headline || `${p.counts.decisions} قرارًا و${p.counts.deliverables} مستندات و${p.counts.dialogues} اجتماعات وحوارات في ${p.company}. كل ما في الصفحة موثّق بإعادة التشغيل.`;
    } catch { /* رابط غير صالح: معاينة عامة */ }
    const target = `/app/#/portfolio/${encodeURIComponent(slug)}`;
    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="profile"><meta property="og:image" content="${esc(origin)}/app/assets/og-portfolio.png">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}"></head>
<body><p><a href="${esc(target)}">${esc(title)}</a></p></body></html>`;
  }

  const routes = {
    'GET /api/portfolio/me': (req) => portfolioEditor(requireUser(req)),
    'PUT /api/portfolio/me': (req, body) => savePortfolio(requireUser(req), body),
    'DELETE /api/portfolio/me': (req) => unpublish(requireUser(req)),
    'GET /api/portfolio/:slug': (req, body, slug) => ({ portfolio: publicPortfolio(slug.toUpperCase()) }),
    'POST /api/challenges': (req) => { const u = requireUser(req); return { challenge: view(createChallenge(u), u) }; },
    'GET /api/my-challenge': (req) => {
      const u = requireUser(req);
      const seed = store.progress(u.id)?.seed;
      const ch = Object.values(S.challenges).find((c) => c.ownerId === u.id && c.seed === seed && !c.revoked);
      return { challenge: ch ? view(ch, u) : null };
    },
    'GET /api/challenges/:code': (req, body, c) => ({ challenge: view(S.challenges[c.toUpperCase()], accountsApi.userFrom(req)) }),
    'DELETE /api/challenges/:code': (req, body, c) => {
      const u = requireUser(req);
      const ch = S.challenges[c.toUpperCase()];
      if (!ch || ch.ownerId !== u.id) throw new HttpError(404, 'لا يوجد تحدٍّ بهذا الرمز');
      ch.revoked = true; save();
      return { ok: true };
    },
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (status, data, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type.startsWith('application/json') ? JSON.stringify(data) : data); };
    const pm = url.pathname.match(/^\/([cp])\/([A-Za-z0-9]{4,12})$/);
    if (req.method === 'GET' && pm) {
      // المعاينات (واتساب وX ولينكدإن) تحتاج رابط صورة كاملًا
      const origin = (process.env.MOHAKI_PUBLIC_URL || `http://${req.headers.host ?? 'localhost'}`).replace(/\/+$/, '');
      const id = pm[2].toUpperCase();
      send(200, pm[1] === 'c' ? previewPage(id, origin) : portfolioPreview(id, origin), 'text/html; charset=utf-8');
      return true;
    }
    const match = Object.keys(routes).map((k) => {
      const [m, path] = k.split(' ');
      if (m !== req.method) return null;
      const r = url.pathname.match(new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`));
      return r ? [k, r.slice(1).map(decodeURIComponent)] : null;
    }).find(Boolean);
    if (!match) return false;
    try {
      if (req.method !== 'GET' && req.method !== 'DELETE' && !String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      send(200, await routes[match[0]](req, body, ...match[1]));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  handle.standing = standing;
  return handle;
}
