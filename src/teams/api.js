// العمل مع زملاء حقيقيين: الزميل الحقيقي (محادثة محفوظة لمدة محددة)، ودوري الفرق (جولات بمواعيد ولوحة ترتيب).
//
// المبادئ:
// - القرارات في محاكاة كل متدرب له وحده. الزميل الحقيقي يناقش ويساعد ولا يقرر عنك.
// - سجل المحادثة محفوظ (يُعلَن ذلك للطرفين). استخدامه لتحسين النماذج يحتاج موافقة منفصلة من الطرفين.
// - نتائج الدوري تُحسب على الخادم بإعادة تشغيل أفعال كل عضو حتى يوم الجولة، والعالم نفسه لكل الفرق.
import { randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
import { replay } from '../replay.js';
import { computePoints } from '../points.js';
import { HttpError } from '../accounts/api.js';
import { firstName } from '../showcase/api.js';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();
const DAY = 864e5;

export function createTeamsApi({ store, world, accountsApi, env = process.env, clock = now }) {
  store.teams ??= {};
  const T = store.teams;
  T.pairs ??= {}; T.queue ??= []; T.leagues ??= {};
  const save = () => store.saveTeams?.();
  const requireUser = (req) => { const u = accountsApi.userFrom(req); if (!u) throw new HttpError(401, 'سجّل الدخول أولًا'); return u; };
  const requireFac = (req) => { const u = requireUser(req); if (!accountsApi.isFacilitator(u)) throw new HttpError(403, 'للمُيسِّرين فقط'); return u; };
  const byEmail = (e) => Object.values(store.users).find((u) => u.email === String(e ?? '').trim().toLowerCase());
  const t = () => Date.parse(clock());

  // ——— الزميل الحقيقي ———
  const active = (p) => t() < Date.parse(p.endsAt);
  const myPairs = (uid) => Object.values(T.pairs).filter((p) => p.members.includes(uid));

  function createPair(a, b, days = 7, by = null) {
    if (a === b) throw new HttpError(400, 'لا يمكن إقران المتدرب بنفسه');
    if (myPairs(a).some(active) || myPairs(b).some(active)) throw new HttpError(409, 'أحد الطرفين لديه زميل حالي بالفعل');
    const p = { id: randomUUID(), members: [a, b], createdAt: clock(), endsAt: new Date(t() + Math.min(30, Math.max(1, days)) * DAY).toISOString(), by, messages: [] };
    T.pairs[p.id] = p;
    T.queue = T.queue.filter((x) => x !== a && x !== b);
    save();
    return p;
  }

  function pairView(p, uid) {
    const partner = store.users[p.members.find((m) => m !== uid)];
    return {
      id: p.id, partner: firstName(partner?.name), partnerDay: dayOf(partner?.id), endsAt: p.endsAt, active: active(p),
      messages: p.messages.map((m) => ({ mine: m.from === uid, text: m.text, at: m.at })),
    };
  }

  function dayOf(uid) {
    const log = store.progress(uid)?.log ?? [];
    return log.filter((a) => a.t === 'endDay').length + 1;
  }

  function requestPair(u) {
    if (!u.emailVerifiedAt) throw new HttpError(403, 'أكّد بريدك أولًا للعمل مع زميل حقيقي.');
    const current = myPairs(u.id).find(active);
    if (current) return { pair: pairView(current, u.id) };
    const other = T.queue.find((x) => x !== u.id && store.users[x] && !myPairs(x).some(active));
    if (other) return { pair: pairView(createPair(u.id, other, 7), u.id) };
    if (!T.queue.includes(u.id)) T.queue.push(u.id);
    save();
    return { waiting: true };
  }

  function sayPair(u, id, body) {
    const p = T.pairs[id];
    if (!p || !p.members.includes(u.id)) throw new HttpError(404, 'لا توجد محادثة بهذا المعرّف');
    if (!active(p)) throw new HttpError(409, 'انتهت مدة العمل المشترك. يبقى السجل للاطلاع.');
    const text = str(body.text, 1500);
    if (!text) throw new HttpError(400, 'اكتب رسالة');
    if (p.messages.length >= 2000) throw new HttpError(409, 'وصلت المحادثة إلى حدها الأقصى');
    p.messages.push({ from: u.id, text, at: clock() });
    save();
    return { pair: pairView(p, u.id) };
  }

  /** محادثات صالحة لتحسين النماذج: الطرفان موافقان، ودون أسماء. */
  function trainingChats() {
    return Object.values(T.pairs)
      .filter((p) => p.messages.length && p.members.every((m) => store.users[m]?.consents?.aiTraining))
      .map((p) => ({ id: p.id, createdAt: p.createdAt, messages: p.messages.map((m) => ({ speaker: m.from === p.members[0] ? 'A' : 'B', text: m.text })) }));
  }

  // ——— دوري الفرق ———
  /** نقاط عضو حتى نهاية يوم معين (يُقتطع سجله عند ذلك اليوم). */
  function pointsUntil(uid, league, untilDay) {
    const p = store.progress(uid);
    if (!p || p.league !== league.id || p.seed !== league.seed) return null;
    let ends = 0; const cut = [];
    for (const a of p.log) { cut.push(a); if (a.t === 'endDay' && ++ends >= untilDay) break; }
    if (ends < untilDay) return { reached: false, day: ends + 1 };
    try {
      const { sim } = replay(world, { seed: p.seed, log: cut, reviews: store.community?.reviews?.[uid] ?? {} });
      return { reached: true, points: computePoints(sim.report(), { finished: sim.finished }).points };
    } catch { return null; }
  }

  function roundStandings(league, round) {
    if (round.results) return round.results; // جولة مغلقة: النتائج مجمّدة
    const rows = league.teams.map((team) => {
      const scores = team.members.map((m) => pointsUntil(m, league, round.untilDay)).filter(Boolean);
      const done = scores.filter((s) => s.reached);
      return { teamId: team.id, name: team.name, members: team.members.length, finished: done.length, score: done.length ? Math.round(done.reduce((x, s) => x + s.points, 0) / done.length) : null };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    if (t() >= Date.parse(round.deadline)) { round.results = rows; round.closedAt = clock(); save(); }
    return rows;
  }

  function leagueView(league, u) {
    const myTeam = league.teams.find((tm) => tm.members.includes(u.id));
    const rounds = league.rounds.map((r) => ({ id: r.id, title: r.title, untilDay: r.untilDay, deadline: r.deadline, closed: !!r.results || t() >= Date.parse(r.deadline), standings: roundStandings(league, r) }));
    const total = {};
    for (const r of rounds) r.standings.forEach((s, i) => { if (s.score !== null) total[s.teamId] = (total[s.teamId] ?? 0) + (league.teams.length - i); });
    const overall = league.teams.map((tm) => ({ teamId: tm.id, name: tm.name, points: total[tm.id] ?? 0 })).sort((a, b) => b.points - a.points);
    const p = store.progress(u.id);
    return {
      id: league.id, name: league.name, seed: league.seed, rounds, overall,
      myTeam: myTeam ? { id: myTeam.id, name: myTeam.name, members: myTeam.members.map((m) => ({ name: firstName(store.users[m]?.name), day: dayOf(m), joined: store.progress(m)?.league === league.id, you: m === u.id })) } : null,
      joined: p?.league === league.id && p?.seed === league.seed,
      isFacilitator: accountsApi.isFacilitator(u),
    };
  }

  function createLeague(fac, body) {
    const name = str(body.name, 80);
    if (name.length < 3) throw new HttpError(400, 'اسم الدوري مطلوب');
    const teams = (Array.isArray(body.teams) ? body.teams : []).slice(0, 20).map((tm) => {
      const members = (tm.emails ?? []).map(byEmail).filter(Boolean).map((u) => u.id);
      return { id: randomUUID(), name: str(tm.name, 60) || 'فريق', members: [...new Set(members)] };
    }).filter((tm) => tm.members.length);
    if (teams.length < 2) throw new HttpError(400, 'يحتاج الدوري فريقين على الأقل لكل منهما عضو مسجل');
    const all = teams.flatMap((tm) => tm.members);
    if (new Set(all).size !== all.length) throw new HttpError(400, 'متدرب في أكثر من فريق');
    const rounds = (Array.isArray(body.rounds) ? body.rounds : []).slice(0, 10).map((r, i) => ({
      id: randomUUID(), title: str(r.title, 80) || `الجولة ${i + 1}`,
      untilDay: Math.min(world.scenario.lengthDays, Math.max(1, Number(r.untilDay) || 5)),
      deadline: Number.isNaN(Date.parse(r.deadline)) ? new Date(t() + (i + 1) * 7 * DAY).toISOString() : new Date(r.deadline).toISOString(),
    })).sort((a, b) => a.untilDay - b.untilDay);
    if (!rounds.length) throw new HttpError(400, 'أضف جولة واحدة على الأقل');
    const league = { id: randomUUID(), name, seed: randomInt(1, 1_000_000), teams, rounds, createdBy: fac.id, createdAt: clock() };
    T.leagues[league.id] = league;
    save();
    return league;
  }

  const getLeague = (id, u) => {
    const l = T.leagues[id];
    if (!l) throw new HttpError(404, 'لا يوجد دوري بهذا المعرّف');
    if (!accountsApi.isFacilitator(u) && !l.teams.some((tm) => tm.members.includes(u.id))) throw new HttpError(403, 'لست عضوًا في هذا الدوري');
    return l;
  };

  const isAdmin = (req) => {
    const token = env.MOHAKI_ADMIN_TOKEN; const got = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    return !!token && got.length === token.length && timingSafeEqual(Buffer.from(token), Buffer.from(got));
  };

  const routes = {
    'GET /api/pairs/mine': (req) => { const u = requireUser(req); const ps = myPairs(u.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); return { pairs: ps.map((p) => pairView(p, u.id)), waiting: T.queue.includes(u.id) }; },
    'POST /api/pairs/request': (req) => requestPair(requireUser(req)),
    'POST /api/pairs/cancel': (req) => { const u = requireUser(req); T.queue = T.queue.filter((x) => x !== u.id); save(); return { ok: true }; },
    'POST /api/pairs/:id/message': (req, body, id) => sayPair(requireUser(req), id, body),
    'POST /api/facilitator/pairs': (req, body) => {
      const fac = requireFac(req);
      const [a, b] = (body.emails ?? []).map(byEmail);
      if (!a || !b) throw new HttpError(400, 'أدخل بريدين لحسابين مسجلين');
      return { pair: pairView(createPair(a.id, b.id, Number(body.days) || 7, fac.id), a.id) };
    },
    'GET /api/facilitator/pairs': (req) => {
      requireFac(req);
      return { pairs: Object.values(T.pairs).map((p) => ({ id: p.id, members: p.members.map((m) => store.users[m]?.name ?? '—'), messages: p.messages.length, endsAt: p.endsAt, active: active(p) })), queue: T.queue.length };
    },
    'GET /api/admin/training-chats': (req) => { if (!isAdmin(req)) throw new HttpError(401, 'رمز المسؤول مطلوب'); return { chats: trainingChats() }; },

    'GET /api/leagues': (req) => {
      const u = requireUser(req);
      const fac = accountsApi.isFacilitator(u);
      return { leagues: Object.values(T.leagues).filter((l) => fac || l.teams.some((tm) => tm.members.includes(u.id))).map((l) => ({ id: l.id, name: l.name, teams: l.teams.length, rounds: l.rounds.length })) };
    },
    'POST /api/leagues': (req, body) => { const fac = requireFac(req); return { league: leagueView(createLeague(fac, body), fac) }; },
    'GET /api/leagues/:id': (req, body, id) => { const u = requireUser(req); return { league: leagueView(getLeague(id, u), u) }; },
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
        for await (const chunk of req) { raw += chunk; if (raw.length > 50_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
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
