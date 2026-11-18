// حساب الجهة: أكاديمية أو جامعة أو شركة تُدخل دفعاتها إلى محاكي برمز دعوة، وتتابع تقدم متدربيها.
//
// المبادئ:
// - المُيسِّر (إدارة محاكي) ينشئ الجهة ويحدد مديريها ببريدهم. مدير الجهة ينشئ الدفعات ورموز الدعوة.
// - المتدرب ينضم برمز الدعوة وبموافقة صريحة على مشاركة تقدمه ونتيجته مع الجهة، ويستطيع المغادرة فتتوقف المشاركة.
// - ما تراه الجهة يحسبه الخادم بإعادة التشغيل: اليوم، والنقاط، وقرار التثبيت، والتجاوزات. لا ترى نصوص حواراته.
import { randomBytes, randomUUID } from 'node:crypto';
import { replay, worldOf } from '../replay.js';
import { computePoints } from '../points.js';
import { appraise, packOf } from '../rolepack.js';
import { HttpError } from '../accounts/api.js';

const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (n = 7) => Array.from(randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');
const KINDS = { academy: 'أكاديمية أو معسكر تدريب', university: 'جامعة أو كلية', company: 'شركة' };

export function createOrgsApi({ store, world, accountsApi, clock = now }) {
  store.orgs ??= {};
  const O = store.orgs;
  O.orgs ??= {}; O.members ??= {};
  const save = () => store.saveOrgs?.();
  const requireUser = (req) => { const u = accountsApi.userFrom(req); if (!u) throw new HttpError(401, 'سجّل الدخول أولًا'); return u; };
  const isFac = (u) => accountsApi.isFacilitator(u);
  const manages = (u, org) => isFac(u) || (!!u.emailVerifiedAt && org.managers.includes(u.email));
  const myOrgs = (u) => Object.values(O.orgs).filter((o) => manages(u, o));
  const cohortByCode = (c) => { for (const o of Object.values(O.orgs)) { const co = o.cohorts.find((x) => x.code === c); if (co) return [o, co]; } return [null, null]; };

  // حالة المتدرب محسوبة بإعادة التشغيل، مع ذاكرة مؤقتة
  const cache = new Map();
  function standing(uid) {
    const p = store.progress(uid);
    if (!p) return { started: false };
    const key = `${p.scenario}|${p.seed}|${p.log.length}|${p.savedAt}`;
    if (cache.get(uid)?.key === key) return cache.get(uid).value;
    let value = { started: false };
    try {
      const w = worldOf(world, p);
      const { sim } = replay(w, { ...p, reviews: store.community?.reviews?.[uid] ?? {} });
      const pts = computePoints(sim.report(), { finished: sim.finished });
      const a = appraise(packOf(world.roles, sim.scenario.id), sim, pts);
      value = { started: true, role: sim.scenario.role, day: Math.min(sim.day, sim.lastDay), lengthDays: sim.lastDay, finished: sim.finished, points: pts.points, band: pts.band.label,
        decision: a?.decision.label ?? null, decisionId: a?.decision.id ?? null, objectives: a ? `${a.achieved}/${a.total}` : null, violations: a?.violations.length ?? 0, lastActive: p.savedAt };
    } catch (e) { if (process.env.MOHAKI_DEBUG) console.error(e); }
    cache.set(uid, { key, value });
    return value;
  }

  function dashboard(org) {
    const cohorts = org.cohorts.map((co) => {
      const members = Object.entries(O.members).filter(([, m]) => m.cohortId === co.id).map(([uid, m]) => {
        const u = store.users[uid];
        if (!u) return null;
        const rec = Object.values(store.records).filter((r) => r.userId === uid && !r.revoked).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0];
        return { name: u.name, email: u.email, joinedAt: m.joinedAt, record: rec?.code ?? null, ...standing(uid) };
      }).filter(Boolean).sort((a, b) => (b.finished ? 1 : 0) - (a.finished ? 1 : 0) || (b.day ?? 0) - (a.day ?? 0) || (b.points ?? -1) - (a.points ?? -1));
      const started = members.filter((m) => m.started);
      const done = members.filter((m) => m.finished);
      return { id: co.id, name: co.name, code: co.code, createdAt: co.createdAt, members,
        summary: { joined: members.length, started: started.length, finished: done.length, confirmed: members.filter((m) => m.decisionId === 'confirmed').length,
          avgPoints: started.length ? Math.round(started.reduce((s, m) => s + m.points, 0) / started.length) : null } };
    });
    return { id: org.id, name: org.name, kind: org.kind, kindLabel: KINDS[org.kind], managers: org.managers, cohorts };
  }

  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  function csv(org, cohortId) {
    const d = dashboard(org);
    const rows = [['الدفعة', 'الاسم', 'البريد', 'الدور', 'اليوم', 'أكمل', 'النقاط', 'المستوى', 'قرار التثبيت', 'الأهداف', 'التجاوزات', 'رمز السجل', 'آخر نشاط']];
    for (const co of d.cohorts.filter((c) => !cohortId || c.id === cohortId)) for (const m of co.members) {
      rows.push([co.name, m.name, m.email, m.role ?? '', m.started ? `${m.day}/${m.lengthDays}` : 'لم يبدأ', m.finished ? 'نعم' : 'لا', m.points ?? '', m.band ?? '', m.decision ?? '', m.objectives ?? '', m.violations ?? '', m.record ?? '', m.lastActive ?? '']);
    }
    return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
  }

  const getOrg = (id, u) => { const o = O.orgs[id]; if (!o || !manages(u, o)) throw new HttpError(404, 'لا توجد جهة بهذا المعرّف'); return o; };

  const routes = {
    // ما يخصني: الجهات التي أديرها، والدفعة التي انضممت إليها
    'GET /api/orgs': (req) => {
      const u = requireUser(req);
      const m = O.members[u.id];
      const [org, co] = m ? (() => { const o = O.orgs[m.orgId]; return [o, o?.cohorts.find((x) => x.id === m.cohortId)]; })() : [null, null];
      return { facilitator: isFac(u), managed: myOrgs(u).map((o) => ({ id: o.id, name: o.name, kindLabel: KINDS[o.kind], cohorts: o.cohorts.length })),
        membership: org && co ? { org: org.name, cohort: co.name, joinedAt: m.joinedAt } : null };
    },
    'POST /api/orgs': (req, body) => {
      const u = requireUser(req);
      if (!isFac(u)) throw new HttpError(403, 'إنشاء الجهات لإدارة محاكي');
      const name = str(body.name, 120);
      if (name.length < 2) throw new HttpError(400, 'اسم الجهة مطلوب');
      const managers = String(body.managers ?? '').split(/[\s,،]+/).map((x) => x.trim().toLowerCase()).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 20);
      const org = { id: randomUUID(), name, kind: KINDS[body.kind] ? body.kind : 'academy', managers, cohorts: [], createdBy: u.id, createdAt: clock() };
      O.orgs[org.id] = org; save();
      return { org: dashboard(org) };
    },
    'GET /api/orgs/:id': (req, body, id) => ({ org: dashboard(getOrg(id, requireUser(req))) }),
    'POST /api/orgs/:id/cohorts': (req, body, id) => {
      const org = getOrg(id, requireUser(req));
      const name = str(body.name, 100);
      if (name.length < 2) throw new HttpError(400, 'اسم الدفعة مطلوب');
      let c; do c = code(); while (cohortByCode(c)[0]);
      org.cohorts.push({ id: randomUUID(), name, code: c, createdAt: clock() }); save();
      return { org: dashboard(org) };
    },
    'GET /api/orgs/:id/export': (req, body, id) => ({ __csv: csv(getOrg(id, requireUser(req)), new URL(req.url, 'http://x').searchParams.get('cohort')) }),
    // المتدرب: الانضمام برمز الدعوة بموافقة صريحة، والمغادرة
    'POST /api/orgs/join': (req, body) => {
      const u = requireUser(req);
      const [org, co] = cohortByCode(str(body.code, 12).toUpperCase());
      if (!org) throw new HttpError(404, 'رمز الدعوة غير صحيح');
      if (body.consent !== true) throw new HttpError(400, `نحتاج موافقتك على مشاركة تقدمك ونتيجتك مع ${org.name}`);
      O.members[u.id] = { orgId: org.id, cohortId: co.id, joinedAt: clock(), consentAt: clock() }; save();
      return { membership: { org: org.name, cohort: co.name } };
    },
    'POST /api/orgs/leave': (req) => { const u = requireUser(req); delete O.members[u.id]; save(); return { ok: true }; },
  };

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const keys = Object.keys(routes).sort((a, b) => (a.includes(':') ? 1 : 0) - (b.includes(':') ? 1 : 0)); // المسارات الثابتة قبل ذات المعاملات
    const match = keys.map((k) => {
      const [m, path] = k.split(' ');
      if (m !== req.method) return null;
      const r = url.pathname.match(new RegExp(`^${path.replace(/:[a-z]+/g, '([^/]+)')}$`));
      return r ? [k, r.slice(1).map(decodeURIComponent)] : null;
    }).find(Boolean);
    if (!match) return false;
    const send = (code_, data) => { res.writeHead(code_, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      let body = {};
      if (req.method === 'POST') {
        if (!String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      const out = await routes[match[0]](req, body, ...match[1]);
      if (out?.__csv) { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="mohaki-cohort.csv"', 'Cache-Control': 'no-store' }); res.end(out.__csv); return true; }
      send(200, out);
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  handle.cohortOf = (uid) => O.members[uid] ?? null;
  handle.manages = (u, orgId) => !!O.orgs[orgId] && manages(u, O.orgs[orgId]);
  return handle;
}
