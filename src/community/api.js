// المجتمع: لوحة المُيسِّر، والجلسات الحية، ومراجعة الأقران.
//
// قاعدة تحفظ قيمة السجل الموثّق: النقاط الرسمية يحكمها الوكيل (Claude أو المحلي) أو المُيسِّر فقط،
// لا الزملاء. أداء المتدرب في لعب أدوار زملائه ومراجعة مستنداتهم يُسجَّل جدارةً مستقلة
// ("التعاون ودعم الزملاء") ولا يؤثر على نقاط أحد.
import { randomUUID } from 'node:crypto';
import { replay } from '../replay.js';
import { HttpError } from '../accounts/api.js';

const str = (v, n = 500) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();

export function createCommunityApi({ store, world, accountsApi, clock = now }) {
  const C = store.community;
  const events = [...world.scenario.events, ...(world.scenario.randomEvents ?? [])];
  const eventOf = (itemId) => events.find((e) => e.id === String(itemId).split('#')[0]);
  const userFrom = (req) => accountsApi.userFrom(req);
  const requireUser = (req) => { const u = userFrom(req); if (!u) throw new HttpError(401, 'سجّل الدخول أولًا'); return u; };
  const requireFacilitator = (req) => {
    const u = requireUser(req);
    if (!accountsApi.isFacilitator(u)) throw new HttpError(403, 'هذه الصفحة للمُيسِّرين فقط');
    return u;
  };

  // ——— 1) لوحة المُيسِّر ———

  /** كل الحوارات المنتهية عبر المتدربين (من سجلات أفعالهم)، الأحدث أولًا. */
  function dialogues() {
    const out = [];
    for (const [userId, p] of store.allProgress()) {
      const user = store.users[userId];
      if (!user) continue;
      p.log.forEach((a, index) => {
        if (a.t !== 'respond' || !a.transcript) return;
        const e = eventOf(a.itemId);
        if (!e?.dialogue) return;
        const review = C.reviews[userId]?.[a.itemId] ?? null;
        out.push({
          userId, userName: user.name, itemId: a.itemId, eventId: e.id, index, savedAt: p.savedAt,
          title: e.title, kind: e.dialogue.mode === 'chat' ? 'chat' : 'meeting', agentMode: a.mode ?? 'offline',
          transcript: a.transcript, ai: { addressed: a.addressed ?? [], optionId: a.optionId },
          concerns: e.dialogue.concerns.map((c) => ({ id: c.id, owner: c.owner, label: c.label, criteria: c.criteria })),
          options: e.options.map((o) => ({ id: o.id, label: o.label })),
          review,
        });
      });
    }
    return out.sort((x, y) => String(y.savedAt).localeCompare(String(x.savedAt)) || y.index - x.index);
  }

  /** تصحيح حكم حوار: يُتحقق منه بإعادة تشغيل كاملة بالمحرك قبل الحفظ. */
  function review(fac, body) {
    const userId = str(body.userId, 64);
    const itemId = str(body.itemId, 120);
    const p = store.progress(userId);
    const action = p?.log.find((a) => a.t === 'respond' && a.itemId === itemId && a.transcript);
    if (!action) throw new HttpError(404, 'لا يوجد حوار بهذا المعرّف');
    const e = eventOf(itemId);
    const concernIds = e.dialogue.concerns.map((c) => c.id);
    const addressed = (Array.isArray(body.addressed) ? body.addressed : []).filter((id) => concernIds.includes(id));
    const optionId = str(body.optionId, 60);
    if (!e.options.some((o) => o.id === optionId)) throw new HttpError(400, 'نتيجة غير موجودة في خيارات الحدث');
    const next = { ...(C.reviews[userId] ?? {}), [itemId]: { addressed, optionId, note: str(body.note, 600), by: fac.id, byName: fac.name, at: clock(), ai: { addressed: action.addressed ?? [], optionId: action.optionId, mode: action.mode ?? null } } };
    // تغيير النتيجة قد يغيّر ما يحدث بعدها (أحداث مشروطة)، فيُرفض التصحيح إن أبطل أفعالًا لاحقة
    try {
      replay(world, { ...p, reviews: next }, { strict: true });
    } catch (err) {
      throw new HttpError(422, `لا يمكن تطبيق هذا التصحيح لأنه يغيّر مسار الأحداث اللاحقة لدى المتدرب (${err.message}). صحّح الاعتراضات فقط، أو اترك النتيجة كما هي.`);
    }
    C.reviews[userId] = next;
    store.saveCommunity();
    return next[itemId];
  }

  /** مدى اتفاق الوكيل مع المُيسِّر، ومجموعة البيانات لمعايرة النموذج. */
  function calibration() {
    const rows = dialogues().filter((d) => d.review);
    const groups = {};
    for (const d of rows) {
      const g = (groups[d.agentMode] ??= { dialogues: 0, concerns: 0, concernsAgree: 0, decisionsAgree: 0 });
      g.dialogues += 1;
      for (const c of d.concerns) {
        g.concerns += 1;
        if (d.ai.addressed.includes(c.id) === d.review.addressed.includes(c.id)) g.concernsAgree += 1;
      }
      if (d.ai.optionId === d.review.optionId) g.decisionsAgree += 1;
    }
    const summary = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
      dialogues: g.dialogues,
      concernAgreement: g.concerns ? Math.round((g.concernsAgree / g.concerns) * 100) : null,
      decisionAgreement: Math.round((g.decisionsAgree / g.dialogues) * 100),
    }]));
    return {
      reviewed: rows.length,
      byAgentMode: summary,
      dataset: rows.map((d) => ({ eventId: d.eventId, transcript: d.transcript, ai: d.ai, agentMode: d.agentMode, human: { addressed: d.review.addressed, optionId: d.review.optionId, note: d.review.note } })),
    };
  }

  // ——— 2) الجلسات الحية ———

  const userByEmail = (email) => Object.values(store.users).find((u) => u.email === String(email ?? '').trim().toLowerCase());
  const meetingEvents = world.scenario.events.filter((e) => e.dialogue && e.dialogue.mode !== 'chat');
  const personOf = (id) => world.company.people.find((p) => p.id === id);

  /** دور المستخدم في الجلسة: presenter أو معرّف شخصية أو facilitator، أو null. */
  function roleIn(s, u) {
    if (s.presenterId === u.id) return 'presenter';
    const r = Object.entries(s.roles).find(([, uid]) => uid === u.id);
    if (r) return r[0];
    if (accountsApi.isFacilitator(u)) return 'facilitator';
    return null;
  }

  /** بطاقة الدور: ما يحتاجه لاعب الدور ليؤديه بالمعلومات نفسها التي يملكها الوكيل. */
  function roleCard(e, role) {
    const spec = e.dialogue;
    if (role === 'presenter') {
      return { kind: 'presenter', title: 'أنت مدير المنتجات (المتدرب)', brief: e.body, tips: spec.placeholder ?? '' };
    }
    if (role === 'facilitator') {
      return {
        kind: 'facilitator', title: 'أنت المُيسِّر', brief: spec.topic,
        concerns: spec.concerns.map((c) => ({ id: c.id, owner: personOf(c.owner)?.name, label: c.label, criteria: c.criteria })),
        outcomes: e.options.map((o) => ({ id: o.id, label: o.label, guide: spec.outcomes?.[o.id]?.guide ?? '' })),
      };
    }
    const p = personOf(role);
    const mine = spec.concerns.filter((c) => c.owner === role);
    return {
      kind: 'role', speaker: role, title: `أنت ${p?.name} — ${p?.title}`, persona: p?.persona, cares: p?.cares ?? [],
      facts: spec.topic,
      opening: spec.opening.filter((l) => l.speaker === role).map((l) => l.text),
      concerns: mine.map((c) => ({ label: c.label, convinceWhen: c.criteria, ifConvinced: c.replyAddressed, ifNot: c.replyOpen })),
      chair: spec.chair === role,
    };
  }

  function sessionView(s, u) {
    const e = events.find((x) => x.id === s.eventId);
    const role = roleIn(s, u);
    const nameOfUser = (uid) => (uid === 'facilitator' ? 'المُيسِّر' : store.users[uid]?.name ?? '—');
    return {
      id: s.id, eventId: s.eventId, title: e.title, scheduledAt: s.scheduledAt, status: s.status,
      presenter: { id: s.presenterId, name: nameOfUser(s.presenterId) },
      roles: e.dialogue.participants.map((pid) => ({ speaker: pid, character: personOf(pid)?.name, player: nameOfUser(s.roles[pid] ?? 'facilitator'), byFacilitator: !s.roles[pid] })),
      myRole: role,
      card: roleCard(e, role),
      messages: s.messages,
      result: s.status === 'closed' && (role === 'presenter' || role === 'facilitator') ? s.result : null,
    };
  }

  function getSession(id, u) {
    const s = C.sessions[id];
    if (!s) throw new HttpError(404, 'لا توجد جلسة بهذا المعرّف');
    if (!roleIn(s, u)) throw new HttpError(403, 'لست مشاركًا في هذه الجلسة');
    return s;
  }

  function createSession(fac, body) {
    const e = meetingEvents.find((x) => x.id === body.eventId);
    if (!e) throw new HttpError(400, 'اختر اجتماعًا حواريًا من السيناريو');
    const presenter = userByEmail(body.presenterEmail);
    if (!presenter) throw new HttpError(400, 'لا يوجد متدرب بهذا البريد ليكون المقدّم');
    const roles = {};
    for (const pid of e.dialogue.participants) {
      const email = body.roles?.[pid];
      if (!email) continue; // الدور غير المسند يؤديه المُيسِّر
      const u = userByEmail(email);
      if (!u) throw new HttpError(400, `لا يوجد حساب بالبريد ${email}`);
      if (u.id === presenter.id) throw new HttpError(400, 'المقدّم لا يلعب دورًا في جلسته');
      roles[pid] = u.id;
    }
    const s = { id: randomUUID(), eventId: e.id, presenterId: presenter.id, roles, createdBy: fac.id, scheduledAt: str(body.scheduledAt, 40) || clock(), status: 'scheduled', messages: [], ratings: {}, result: null };
    C.sessions[s.id] = s;
    store.saveCommunity();
    return s;
  }

  function post(s, u, body) {
    if (s.status === 'closed') throw new HttpError(400, 'انتهت الجلسة');
    const role = roleIn(s, u);
    const e = events.find((x) => x.id === s.eventId);
    let as;
    if (role === 'presenter') as = 'trainee';
    else if (role === 'facilitator') {
      as = body.as === 'facilitator' || e.dialogue.participants.includes(body.as) ? body.as : 'facilitator';
    } else as = role;
    const text = str(body.text, 1500);
    if (!text) throw new HttpError(400, 'الرسالة فارغة');
    if (s.status === 'scheduled') s.status = 'live';
    s.messages.push({ i: s.messages.length, by: u.id, as, text, at: clock() });
    store.saveCommunity();
  }

  function startSession(s) {
    if (s.status === 'closed') throw new HttpError(400, 'انتهت الجلسة');
    const e = events.find((x) => x.id === s.eventId);
    if (!s.messages.length) {
      for (const l of e.dialogue.opening) s.messages.push({ i: s.messages.length, by: 'system', as: l.speaker, text: l.text, at: clock() });
    }
    s.status = 'live';
    store.saveCommunity();
  }

  /** ختام الجلسة: حكم المُيسِّر يصبح نتيجة اجتماع المقدّم، وتقييم لاعبي الأدوار جدارة تعاون. */
  function closeSession(s, fac, body) {
    const e = events.find((x) => x.id === s.eventId);
    const concernIds = e.dialogue.concerns.map((c) => c.id);
    const addressed = (Array.isArray(body.addressed) ? body.addressed : []).filter((id) => concernIds.includes(id));
    const optionId = str(body.optionId, 60);
    if (!e.options.some((o) => o.id === optionId)) throw new HttpError(400, 'اختر نتيجة الاجتماع');
    const ratings = {};
    for (const [key, r] of Object.entries(body.ratings ?? {})) {
      const uid = s.roles[key] ?? key; // يقبل معرّف الدور (الشخصية) أو معرّف المستخدم
      const n = Number(r);
      if (Object.values(s.roles).includes(uid) && n >= 1 && n <= 5) ratings[uid] = n;
    }
    const transcript = s.messages.map((m) => ({ speaker: m.as === 'facilitator' ? e.dialogue.chair : m.as, text: m.text }));
    s.status = 'closed';
    s.closedAt = clock();
    s.ratings = ratings;
    s.result = { addressed, optionId, note: str(body.note, 600), by: fac.id, byName: fac.name, at: clock() };
    (C.liveResults[s.presenterId] ??= {})[s.eventId] = { sessionId: s.id, addressed, optionId, transcript, note: s.result.note };
    store.saveCommunity();
    return s.result;
  }

  // ——— التعاون ودعم الزملاء (مستقل عن النقاط) ———
  function collaboration(userId) {
    const roles = Object.values(C.sessions).filter((s) => s.status === 'closed' && Object.values(s.roles).includes(userId))
      .map((s) => ({ sessionId: s.id, title: events.find((x) => x.id === s.eventId)?.title, rating: s.ratings?.[userId] ?? null, at: s.closedAt }));
    return { roles };
  }

  const routes = {
    'GET /api/live': (req) => {
      const u = requireUser(req);
      const fac = accountsApi.isFacilitator(u);
      const list = Object.values(C.sessions).filter((s) => fac || roleIn(s, u)).sort((a, b) => String(b.scheduledAt).localeCompare(String(a.scheduledAt)));
      return {
        meetings: meetingEvents.map((e) => ({ id: e.id, title: e.title, day: e.day, participants: e.dialogue.participants.map((pid) => ({ id: pid, name: personOf(pid)?.name, title: personOf(pid)?.title })) })),
        sessions: list.map((s) => { const v = sessionView(s, u); return { id: v.id, title: v.title, scheduledAt: v.scheduledAt, status: v.status, presenter: v.presenter.name, myRole: v.myRole, roles: v.roles }; }),
      };
    },
    'POST /api/live': (req, body) => ({ session: sessionView(createSession(requireFacilitator(req), body), requireUser(req)) }),
    'GET /api/live/:id': (req, body, id) => { const u = requireUser(req); return { session: sessionView(getSession(id, u), u) }; },
    'POST /api/live/:id/message': (req, body, id) => { const u = requireUser(req); const s = getSession(id, u); post(s, u, body); return { session: sessionView(s, u) }; },
    'POST /api/live/:id/start': (req, body, id) => { const u = requireFacilitator(req); const s = getSession(id, u); startSession(s); return { session: sessionView(s, u) }; },
    'POST /api/live/:id/close': (req, body, id) => { const u = requireFacilitator(req); const s = getSession(id, u); closeSession(s, u, body); return { session: sessionView(s, u) }; },
    'GET /api/live-results': (req) => { const u = requireUser(req); return { results: C.liveResults[u.id] ?? {} }; },
    'GET /api/collaboration': (req) => collaboration(requireUser(req).id),

    'GET /api/facilitator/dialogues': (req) => {
      requireFacilitator(req);
      const filter = new URL(req.url, 'http://x').searchParams.get('filter');
      const list = dialogues();
      return { dialogues: (filter === 'reviewed' ? list.filter((d) => d.review) : filter === 'all' ? list : list.filter((d) => !d.review)).slice(0, 200) };
    },
    'POST /api/facilitator/review': (req, body) => ({ review: review(requireFacilitator(req), body) }),
    'GET /api/facilitator/calibration': (req) => { requireFacilitator(req); return calibration(); },
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const key = `${req.method} ${url.pathname}`;
    const match = Object.entries(routes).find(([k]) => {
      if (k === key) return true;
      const [m, path] = k.split(' ');
      if (m !== req.method || !path.includes(':')) return false;
      const re = new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`);
      return re.test(url.pathname);
    });
    if (!match) return false;
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      let body = {};
      if (req.method !== 'GET') {
        if (!String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 500_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      const [m, path] = match[0].split(' ');
      const params = path.includes(':') ? url.pathname.match(new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`)).slice(1).map(decodeURIComponent) : [];
      send(200, await match[1](req, body, ...params));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  handle.routes = routes;
  return handle;
}
