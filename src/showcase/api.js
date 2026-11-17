// العرض والتسويق الذاتي: "تحداني على نفس الشركة"، وملف الأعمال الموثّق.
//
// المبدأ: كل ما يُعرض للعامة يُحسب على الخادم بإعادة تشغيل الأفعال بالمحرك الحتمي،
// فلا يمكن تجميله من المتصفح. ولا يظهر للعامة إلا الاسم الأول والنتيجة، ولا بريد ولا بيانات تواصل.
import { randomBytes } from 'node:crypto';
import { replay } from '../replay.js';
import { computePoints } from '../points.js';
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
      value = { seed: p.seed, challenge: p.challenge ?? null, points: pts.points, band: pts.band, days: report.daysWorked, finished: sim.finished };
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

  const routes = {
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
    const pm = url.pathname.match(/^\/c\/([A-Za-z0-9]{4,12})$/);
    if (req.method === 'GET' && pm) {
      // المعاينات (واتساب وX ولينكدإن) تحتاج رابط صورة كاملًا
      const origin = (process.env.MOHAKI_PUBLIC_URL || `http://${req.headers.host ?? 'localhost'}`).replace(/\/+$/, '');
      send(200, previewPage(pm[1].toUpperCase(), origin), 'text/html; charset=utf-8');
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
      for await (const chunk of req) { if (chunk.length > 10_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
      send(200, await routes[match[0]](req, {}, ...match[1]));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  handle.standing = standing;
  return handle;
}
