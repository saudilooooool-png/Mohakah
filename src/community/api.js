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

  const routes = {
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
