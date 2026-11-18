// الحسابات والتقدم والسجلات الموثقة وقائمة المرشحين لجهات التوظيف.
//
// مبادئ:
// - أقل قدر من البيانات الشخصية (لا هوية وطنية ولا رقم جوال في هذه المرحلة).
// - موافقات منفصلة وصريحة وقابلة للسحب، مع سجل بتاريخ كل تغيير (نظام حماية البيانات الشخصية).
// - النتيجة لا تُقبل من المتصفح: الخادم يعيد تشغيل الأفعال بالمحرك الحتمي ويحسبها بنفسه.
// - السجل ليس "شهادة خبرة" ولا "شهادة خدمة" (المادة 64 من نظام العمل يصدرها صاحب العمل)،
//   ولا "شهادة تدريب معتمدة" قبل ترخيص البرنامج.
import { collaborationSummary, forgetUser } from '../community/collab.js';

import { realWorkSummary } from '../work/summary.js';
import { orgTasksSummary } from '../orgs/api.js';
import { marketSummary } from '../market/summary.js';
import { appraise, packOf } from '../rolepack.js';
import { randomBytes, scryptSync, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { replay, worldOf } from '../replay.js';
import { computePoints, RECOMMENDATION_RULES } from '../points.js';
import { renderEmail } from './mailer.js';

const SESSION_DAYS = 30;
const COOKIE = 'mohaki_session';
const MAX_LOG = 3000;
const VERIFY_TTL = 48 * 3600e3; // رابط تأكيد البريد: 48 ساعة
const RESET_TTL = 3600e3;       // رابط استعادة كلمة المرور: ساعة واحدة
const GENERIC_RESET = 'إذا كان البريد مسجلًا لدينا، فستصلك رسالة فيها رابط لتعيين كلمة مرور جديدة خلال دقائق.';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toISOString();
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const str = (v, n = 120) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

function recordCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `MHK-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter(([k, v]) => k && v).map(([k, v]) => [k, decodeURIComponent(v)]));
}

export function cleanProfile(raw = {}) {
  const year = Number(raw.graduationYear);
  return {
    university: str(raw.university, 100),
    major: str(raw.major, 100),
    graduationYear: Number.isInteger(year) && year >= 1990 && year <= 2040 ? year : null,
    city: str(raw.city, 60),
    // صفحة المتدرب (كلها اختيارية): العمر من سنة الميلاد، والسيرة الذاتية، وأرقام التواصل.
    // لا تُشارك مع جهات التوظيف إلا بموافقة المشاركة الصريحة.
    birthYear: Number.isInteger(Number(raw.birthYear)) && Number(raw.birthYear) >= 1950 && Number(raw.birthYear) <= 2012 ? Number(raw.birthYear) : null,
    phone: /^\+?[0-9 ]{8,16}$/.test(str(raw.phone, 20)) ? str(raw.phone, 20) : '',
    phone2: /^\+?[0-9 ]{8,16}$/.test(str(raw.phone2, 20)) ? str(raw.phone2, 20) : '',
    linkedin: /^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(str(raw.linkedin, 200)) ? str(raw.linkedin, 200) : '',
    cvUrl: /^https:\/\//i.test(str(raw.cvUrl, 300)) ? str(raw.cvUrl, 300) : '',
    summary: str(raw.summary, 600),
    education: str(raw.education, 1200),
    experience: str(raw.experience, 2000),
    skills: str(raw.skills, 400),
  };
}

export function createAccountsApi({ store, world, env = process.env, now: clock = now, mailer = null, publicUrl = env.MOHAKI_PUBLIC_URL || 'http://localhost:4173' }) {
  const secureCookie = env.MOHAKI_SECURE_COOKIE === '1';
  const employerToken = env.MOHAKI_EMPLOYER_TOKEN || null;
  // المُيسِّرون: بريدهم في MOHAKI_FACILITATORS (مفصولة بفواصل)، ويجب أن يكون مؤكدًا
  const facilitators = new Set(String(env.MOHAKI_FACILITATORS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean));
  const isFacilitator = (u) => !!u && facilitators.has(u.email) && !!u.emailVerifiedAt;
  const attempts = new Map(); // email -> [timestamps] لحماية بسيطة من التخمين
  const resetRequests = new Map(); // email -> [timestamps]
  // روابط البريد مبنية من عنوان مُعدّ مسبقًا، لا من ترويسة Host في الطلب (حماية من تزوير روابط الاستعادة)
  const appUrl = (path) => `${publicUrl.replace(/\/$/, '')}/app/#/${path}`;

  // رموز لمرة واحدة: يُخزن مجزأً مع الغرض والصلاحية، ويُبطل بعد الاستخدام
  function issueToken(userId, purpose, ttl) {
    const raw = randomBytes(32).toString('base64url');
    const t = Date.now();
    for (const [k, v] of Object.entries(store.tokens)) {
      if (new Date(v.expiresAt).getTime() < t || (v.userId === userId && v.purpose === purpose)) delete store.tokens[k];
    }
    store.tokens[sha256(raw)] = { userId, purpose, expiresAt: new Date(t + ttl).toISOString() };
    store.saveTokens();
    return raw;
  }

  function consumeToken(raw, purpose) {
    const key = sha256(String(raw ?? ''));
    const t = store.tokens[key];
    if (!t || t.purpose !== purpose || new Date(t.expiresAt) < new Date() || !store.users[t.userId]) {
      throw new HttpError(400, 'الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا.');
    }
    delete store.tokens[key];
    store.saveTokens();
    return store.users[t.userId];
  }

  async function sendMail(to, subject, body, link) {
    if (!mailer) return;
    try { await mailer.send({ to, subject, ...renderEmail(body), link }); } catch (err) { console.error('تعذر إرسال البريد', err); }
  }

  async function sendVerification(user) {
    const sent = (user.verifySent ?? []).filter((t) => Date.now() - new Date(t).getTime() < 864e5);
    if (sent.length && Date.now() - new Date(sent.at(-1)).getTime() < 60e3) throw new HttpError(429, 'أُرسل رابط قبل أقل من دقيقة. تحقق من بريدك.');
    if (sent.length >= 5) throw new HttpError(429, 'وصلت إلى الحد اليومي لرسائل التأكيد. حاول غدًا.');
    user.verifySent = [...sent, clock()];
    store.saveUsers();
    const link = appUrl(`confirm-email/${issueToken(user.id, 'verify', VERIFY_TTL)}`);
    await sendMail(user.email, 'أكّد بريدك في محاكي', {
      title: 'أكّد بريدك الإلكتروني',
      greeting: `مرحبًا ${user.name}،`,
      lines: ['شكرًا لانضمامك إلى محاكي. أكّد بريدك حتى نتمكن من إصدار سجل الأداء الموثّق باسمك، ومن مشاركته مع جهات التوظيف إن وافقت على ذلك.'],
      action: { label: 'تأكيد البريد', url: link },
      note: 'الرابط صالح لمدة 48 ساعة. إذا لم تنشئ حسابًا في محاكي، تجاهل هذه الرسالة.',
    }, link);
  }

  /**
   * الملخص اليومي على البريد الحقيقي (باختيار المتدرب): بعد إنهاء يوم عمل في المحاكاة،
   * رسالة واحدة كحد أقصى في اليوم الحقيقي، بأرقام الشركة وما حدث وما ينتظره.
   */
  async function maybeDigest(u, before, after) {
    if (!u.prefs?.dailyDigest || !u.emailVerifiedAt) return;
    const ends = (p) => (p?.log ?? []).filter((a) => a.t === 'endDay').length;
    if (ends(after) <= ends(before)) return;
    const today = clock().slice(0, 10);
    if (u.lastDigestOn === today) return;
    let sim;
    try { ({ sim } = replay(worldOf(world, after), { ...after, reviews: store.community?.reviews?.[u.id] ?? {} })); } catch { return; }
    const h = sim.history; const now = h.at(-1); const prev = h.at(-2) ?? now;
    const d = (a, b) => { const x = Math.round(a - b); return x ? ` (${x > 0 ? '+' : ''}${x.toLocaleString('en')})` : ''; };
    const lastDay = sim.day - 1;
    const happened = sim.feed.filter((f) => f.day === lastDay).map((f) => `• ${f.text}`);
    const open = sim.finished ? 0 : sim.inbox().length;
    u.lastDigestOn = today;
    store.saveUsers();
    await sendMail(u.email, `NOVA TECH · ملخص يوم العمل ${lastDay}`, {
      title: `ملخص يوم العمل ${lastDay}`,
      greeting: `صباح الخير ${u.name}،`,
      lines: [
        `الإيراد الشهري: ${Math.round(now.mrr).toLocaleString('en')} ريال${d(now.mrr, prev.mrr)} · العملاء: ${now.customers}${d(now.customers, prev.customers)} · رضا العملاء: ${now.avgHealth}/100${d(now.avgHealth, prev.avgHealth)} · تذاكر الدعم: ${Math.round(now.supportBacklog)}${d(now.supportBacklog, prev.supportBacklog)}`,
        ...(happened.length ? ['ما حدث:', ...happened.slice(0, 6)] : []),
        sim.finished ? 'انتهت فترة عملك. افتح سجلك المهني.' : `ينتظرك ${open} ${open === 1 ? 'بند' : 'بنود'} في بريد العمل.`,
      ],
      action: { label: sim.finished ? 'افتح سجلك المهني' : 'أكمل يوم العمل', url: appUrl(sim.finished ? 'report' : 'inbox') },
      note: 'تصلك هذه الرسالة لأنك فعّلت الملخص اليومي. أوقفه من صفحة حسابي في أي وقت.',
    });
  }

  const publicUser = (u) => u && {
    id: u.id, name: u.name, email: u.email, emailVerified: !!u.emailVerifiedAt, profile: u.profile, consents: u.consents, createdAt: u.createdAt,
    prefs: { dailyDigest: !!u.prefs?.dailyDigest },
    role: isFacilitator(u) ? 'facilitator' : 'trainee',
    records: Object.values(store.records).filter((r) => r.userId === u.id && !r.revoked).map((r) => r.code),
  };

  function userFrom(req) {
    const token = parseCookies(req.headers?.cookie)[COOKIE];
    if (!token) return null;
    const s = store.sessions[sha256(token)];
    if (!s || new Date(s.expiresAt) < new Date()) return null;
    return store.users[s.userId] ?? null;
  }

  function startSession(res, userId) {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    store.sessions[sha256(token)] = { userId, expiresAt };
    store.saveSessions();
    res.setHeader?.('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secureCookie ? '; Secure' : ''}`);
  }

  function setConsents(user, consents) {
    const next = {
      processing: consents.processing === true,
      employerSharing: consents.employerSharing === true,
      peerReview: consents.peerReview === true,
      // استخدام محادثاتي مع الزميل الحقيقي (دون اسمي) لتحسين نماذج المحاكاة
      aiTraining: consents.aiTraining === true,
    };
    for (const [k, v] of Object.entries(next)) {
      if (user.consents?.[k] !== v) user.consentHistory.push({ consent: k, value: v, at: clock() });
    }
    user.consents = next;
  }

  const routes = {
    'POST /api/auth/register': async (req, res, body) => {
      const name = str(body.name, 80);
      const email = str(body.email, 120).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      if (name.length < 3) throw new HttpError(400, 'الاسم مطلوب كما تريد أن يظهر في سجلك');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'البريد الإلكتروني غير صالح');
      if (password.length < 8) throw new HttpError(400, 'كلمة المرور 8 أحرف على الأقل');
      if (body.consents?.processing !== true) throw new HttpError(400, 'الموافقة على معالجة البيانات لأغراض التدريب مطلوبة لإنشاء الحساب');
      if (Object.values(store.users).some((u) => u.email === email)) throw new HttpError(409, 'يوجد حساب بهذا البريد');
      const user = { id: randomUUID(), name, email, passwordHash: hashPassword(password), profile: cleanProfile(body.profile), consents: {}, consentHistory: [], createdAt: clock() };
      setConsents(user, body.consents);
      store.users[user.id] = user;
      store.saveUsers();
      startSession(res, user.id);
      await sendVerification(user).catch(() => {});
      return publicUser(user);
    },

    'POST /api/auth/verify/send': async (req, res, body, u) => {
      if (u.emailVerifiedAt) return { ok: true, alreadyVerified: true };
      await sendVerification(u);
      return { ok: true };
    },

    'POST /api/auth/verify': (req, res, body) => {
      const u = consumeToken(body.token, 'verify');
      u.emailVerifiedAt ??= clock();
      store.saveUsers();
      return { ok: true, user: publicUser(u) };
    },

    // لا يكشف هل البريد مسجل: الرد نفسه في كل الحالات
    'POST /api/auth/reset/request': async (req, res, body) => {
      const email = str(body.email, 120).toLowerCase();
      const recent = (resetRequests.get(email) ?? []).filter((t) => Date.now() - t < 3600e3);
      if (recent.length >= 3) return { ok: true, message: GENERIC_RESET };
      resetRequests.set(email, [...recent, Date.now()]);
      const user = Object.values(store.users).find((u) => u.email === email);
      if (user) {
        const link = appUrl(`reset-password/${issueToken(user.id, 'reset', RESET_TTL)}`);
        await sendMail(user.email, 'تعيين كلمة مرور جديدة في محاكي', {
          title: 'تعيين كلمة مرور جديدة',
          greeting: `مرحبًا ${user.name}،`,
          lines: ['طلبت تعيين كلمة مرور جديدة لحسابك في محاكي.'],
          action: { label: 'تعيين كلمة المرور', url: link },
          note: 'الرابط صالح لمدة ساعة واحدة ولمرة واحدة. إذا لم تطلب ذلك، تجاهل الرسالة؛ كلمة مرورك الحالية لم تتغير.',
        }, link);
      }
      return { ok: true, message: GENERIC_RESET };
    },

    // تعيين كلمة المرور يُنهي كل الجلسات المفتوحة، ويثبت ملكية البريد
    'POST /api/auth/reset': (req, res, body) => {
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 8) throw new HttpError(400, 'كلمة المرور 8 أحرف على الأقل');
      const u = consumeToken(body.token, 'reset');
      u.passwordHash = hashPassword(password);
      u.emailVerifiedAt ??= clock();
      u.passwordChangedAt = clock();
      for (const [k, s] of Object.entries(store.sessions)) if (s.userId === u.id) delete store.sessions[k];
      store.saveUsers(); store.saveSessions();
      startSession(res, u.id);
      return publicUser(u);
    },

    'POST /api/auth/login': (req, res, body) => {
      const email = str(body.email, 120).toLowerCase();
      const recent = (attempts.get(email) ?? []).filter((t) => Date.now() - t < 15 * 60e3);
      if (recent.length >= 10) throw new HttpError(429, 'محاولات كثيرة. حاول بعد ربع ساعة');
      const user = Object.values(store.users).find((u) => u.email === email);
      if (!user || !verifyPassword(String(body.password ?? ''), user.passwordHash)) {
        attempts.set(email, [...recent, Date.now()]);
        throw new HttpError(401, 'البريد أو كلمة المرور غير صحيحة');
      }
      attempts.delete(email);
      startSession(res, user.id);
      return publicUser(user);
    },

    'POST /api/auth/logout': (req, res) => {
      const token = parseCookies(req.headers?.cookie)[COOKIE];
      if (token) { delete store.sessions[sha256(token)]; store.saveSessions(); }
      res.setHeader?.('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      return { ok: true };
    },

    'GET /api/me': (req) => {
      const u = userFrom(req);
      return { user: publicUser(u) ?? null };
    },

    'PATCH /api/me': (req, res, body, u) => {
      if (body.name !== undefined) {
        const name = str(body.name, 80);
        if (name.length < 3) throw new HttpError(400, 'الاسم قصير جدًا');
        u.name = name;
      }
      if (body.profile) u.profile = cleanProfile({ ...u.profile, ...body.profile });
      if (body.prefs && typeof body.prefs.dailyDigest === 'boolean') u.prefs = { ...u.prefs, dailyDigest: body.prefs.dailyDigest };
      if (body.consents) {
        if (body.consents.processing === false) throw new HttpError(400, 'لسحب الموافقة على المعالجة، احذف الحساب');
        setConsents(u, { ...u.consents, ...body.consents });
      }
      store.saveUsers();
      return publicUser(u);
    },

    // حق الحذف: يحذف الحساب والتقدم والجلسات، ويُلغي السجلات الصادرة فلا تعود صالحة للتحقق
    'DELETE /api/me': (req, res, body, u) => {
      for (const r of Object.values(store.records)) if (r.userId === u.id) { r.revoked = true; r.name = null; }
      for (const [k, s] of Object.entries(store.sessions)) if (s.userId === u.id) delete store.sessions[k];
      delete store.users[u.id];
      store.deleteProgress(u.id);
      forgetUser(store.community, u.id); store.saveCommunity();
      // روابط العرض العامة تتوقف: التحديات تُلغى، وملف الأعمال يُحذف
      if (store.showcase) {
        for (const c of Object.values(store.showcase.challenges ?? {})) if (c.ownerId === u.id) c.revoked = true;
        delete store.showcase.portfolios?.[u.id];
        store.saveShowcase?.();
      }
      if (store.orgs) { delete store.orgs.members?.[u.id]; store.saveOrgs?.(); }
      if (store.market) {
        for (const [k, a] of Object.entries(store.market.answers ?? {})) if (a.userId === u.id) delete store.market.answers[k];
        store.saveMarket?.();
      }
      // مكتبة الأعمال الواقعية: تُحذف طلباته وتسليماته
      if (store.work) {
        for (const [k, a] of Object.entries(store.work.apps ?? {})) if (a.userId === u.id) delete store.work.apps[k];
        store.saveWork?.();
      }
      // المحادثات مع الزميل الحقيقي: تُحذف رسائله، ويخرج من الفرق وقائمة الانتظار
      if (store.teams) {
        for (const p of Object.values(store.teams.pairs ?? {})) if (p.members.includes(u.id)) { p.messages = p.messages.filter((m) => m.from !== u.id); p.endsAt = clock(); }
        store.teams.queue = (store.teams.queue ?? []).filter((x) => x !== u.id);
        for (const l of Object.values(store.teams.leagues ?? {})) for (const tm of l.teams) tm.members = tm.members.filter((m) => m !== u.id);
        store.saveTeams?.();
      }
      store.saveUsers(); store.saveSessions(); store.saveRecords();
      res.setHeader?.('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      return { ok: true };
    },

    'GET /api/progress': (req, res, body, u) => {
      const p = store.progress(u.id);
      return { progress: p && { ...p, reviews: store.community.reviews[u.id] ?? {} } };
    },

    'PUT /api/progress': (req, res, body, u) => {
      const seed = Number(body.seed);
      if (!Number.isInteger(seed) || seed < 1) throw new HttpError(400, 'بذرة غير صالحة');
      if (!Array.isArray(body.log) || body.log.length > MAX_LOG) throw new HttpError(400, 'سجل أفعال غير صالح');
      const threads = body.threads && typeof body.threads === 'object' ? body.threads : {};
      const clip = (o, n = 400) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).slice(0, n).map(([k, v]) => [String(k).slice(0, 80), Number(v) || 0])) : {});
      const read = clip(body.read, 100);
      // الانضمام لتحدٍّ: يُقبل فقط إن كان التحدي قائمًا وبالبذرة نفسها
      const ch = store.showcase?.challenges?.[str(body.challenge, 12)];
      const challenge = ch && !ch.revoked && ch.seed === seed && (ch.scenario ?? '') === (world.byScenario?.[str(body.scenario, 40)] ? str(body.scenario, 40) : '') && ch.ownerId !== u.id ? ch.code : undefined;
      // الانضمام لدوري فرق: عضو في أحد فرقه، وبذرة الدوري نفسها
      const lg = store.teams?.leagues?.[str(body.league, 64)];
      const league = lg && lg.seed === seed && lg.teams.some((tm) => tm.members.includes(u.id)) ? lg.id : undefined;
      const before = store.progress(u.id);
      store.saveProgress(u.id, { seed, startedAt: str(body.startedAt, 40) || clock(), log: body.log, threads, savedAt: clock(), ...(world.byScenario?.[str(body.scenario, 40)] ? { scenario: str(body.scenario, 40) } : {}),
        read, opened: clip(body.opened), quiz: clip(body.quiz, 200), videoMade: body.videoMade ? 1 : 0,
        goal: body.goal && typeof body.goal === 'object' ? { role: str(body.goal.role, 20), need: str(body.goal.need, 20) } : null, ...(challenge ? { challenge } : {}), ...(league ? { league } : {}) });
      maybeDigest(u, before, store.progress(u.id)).catch(() => {});
      return { ok: true };
    },

    'POST /api/records/issue': (req, res, body, u) => {
      // السجل يحمل اسم صاحبه وقد يُشارك مع جهات توظيف: يجب أن يكون البريد مؤكدًا
      if (!u.emailVerifiedAt) throw new HttpError(403, 'أكّد بريدك الإلكتروني أولًا لإصدار السجل الموثّق.');
      const p = store.progress(u.id);
      if (!p) throw new HttpError(400, 'لا يوجد تقدم محفوظ');
      let sim;
      try {
        ({ sim } = replay(worldOf(world, p), { ...p, reviews: store.community.reviews[u.id] ?? {} }, { strict: true }));
      } catch (err) {
        throw new HttpError(422, `تعذر التحقق من سجل الأفعال: ${err.message}`);
      }
      if (!sim.finished) throw new HttpError(400, `يُصدر السجل بعد إكمال ${sim.scenario.lengthDays} يوم عمل`);
      // نتيجة أي اجتماع حي يجب أن تطابق حكم المُيسِّر المسجّل على الخادم (لا يمكن تعديلها من المتصفح)
      for (const a of p.log.filter((x) => x.t === 'respond' && x.mode === 'human')) {
        const live = store.community?.liveResults?.[u.id]?.[String(a.itemId).split('#')[0]];
        const same = live && live.optionId === a.optionId && [...(live.addressed ?? [])].sort().join() === [...(a.addressed ?? [])].sort().join();
        if (!same) throw new HttpError(422, 'نتيجة اجتماع حي في سجلك لا تطابق حكم المُيسِّر المسجّل.');
      }
      const reviews = store.community.reviews[u.id] ?? {};
      const logHash = sha256(JSON.stringify({ scenario: p.scenario, seed: p.seed, log: p.log, reviews: Object.keys(reviews).length ? reviews : undefined }));
      const existing = Object.values(store.records).find((r) => r.userId === u.id && r.logHash === logHash && !r.revoked);
      if (existing) {
        // نفس الأفعال = نفس النقاط، لكن الأدلة المنفصلة (التعاون والأعمال الواقعية) قد تتحدث
        existing.collaboration = collaborationSummary(store.community, u.id);
        existing.realWork = realWorkSummary(store, u.id);
        existing.marketResearch = marketSummary(store, u.id);
        existing.orgTasks = orgTasksSummary(store, u.id);
        store.saveRecords();
        return existing;
      }
      const report = sim.report();
      const points = computePoints(report, { finished: true });
      let code;
      do code = recordCode(); while (store.records[code]);
      const record = {
        code,
        userId: u.id,
        name: u.name,
        issuedAt: clock(),
        scenarioId: sim.scenario.id,
        role: sim.scenario.role,
        company: world.company.name,
        days: sim.scenario.lengthDays,
        startedAt: p.startedAt,
        overall: report.overall,
        points: points.points,
        band: points.band,
        breakdown: points.breakdown,
        recommendable: points.recommendable,
        occupation: report.occupation && { code: report.occupation.code, titleAr: report.occupation.titleAr, status: report.occupation.status, match: report.occupation.match },
        evidence: { decisions: report.evidence.decisions.length, deliverables: report.evidence.deliverables.length, shipped: report.evidence.shipped.map((s) => s.title) },
        collaboration: collaborationSummary(store.community, u.id),
        realWork: realWorkSummary(store, u.id),
        marketResearch: marketSummary(store, u.id),
        orgTasks: orgTasksSummary(store, u.id),
        // تقييم فترة التجربة بلغة الموارد البشرية: الأهداف، والجدارات، والتجاوزات، وقرار التثبيت
        appraisal: (() => {
          const a = appraise(packOf(world.roles, sim.scenario.id), sim, points);
          return a && { role: a.role, decision: { id: a.decision.id, label: a.decision.label }, achieved: a.achieved, total: a.total,
            objectives: a.objectives.map((o) => ({ label: o.label, ok: o.ok, actual: o.actual })),
            competencies: a.competencies.map((c) => ({ label: c.label, rating: c.rating, ratingLabel: c.ratingLabel })), violations: a.violations.length, weekly: a.weekly };
        })(),
        logHash,
        verifiedBy: 'server-replay',
      };
      store.records[code] = record;
      store.saveRecords();
      return record;
    },
  };

  // صفحة التحقق العامة: بيانات السجل فقط، دون البريد أو بيانات الملف الشخصي
  function publicRecord(code) {
    const r = store.records[code];
    if (!r) throw new HttpError(404, 'لا يوجد سجل بهذا الرمز');
    if (r.revoked) return { code, revoked: true };
    const { userId, ...rest } = r;
    return rest;
  }

  // جهات التوظيف الشريكة: المرشحون الذين وافقوا صراحة على المشاركة ويستوفون شروط التوصية
  function talent() {
    const latest = new Map();
    for (const r of Object.values(store.records)) {
      if (r.revoked || !r.recommendable) continue;
      const prev = latest.get(r.userId);
      if (!prev || r.points > prev.points) latest.set(r.userId, r);
    }
    return [...latest.entries()]
      .map(([userId, r]) => ({ user: store.users[userId], r }))
      .filter(({ user }) => user?.consents?.employerSharing && user.emailVerifiedAt)
      .map(({ user, r }) => ({
        name: user.name, email: user.email, ...user.profile,
        code: r.code, role: r.role, points: r.points, band: r.band.label, occupation: r.occupation, issuedAt: r.issuedAt,
      }))
      .sort((a, b) => b.points - a.points);
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const send = (code, data) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      const verify = url.pathname.match(/^\/api\/records\/(MHK-[A-Z0-9]{4}-[A-Z0-9]{4})$/);
      if (verify && req.method === 'GET') { send(200, publicRecord(verify[1])); return true; }
      if (url.pathname === '/api/talent' && req.method === 'GET') {
        const auth = req.headers?.authorization ?? '';
        if (!employerToken || auth !== `Bearer ${employerToken}`) throw new HttpError(401, 'غير مصرح');
        send(200, { rules: RECOMMENDATION_RULES, candidates: talent() });
        return true;
      }
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) return false;
      let body = {};
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // طلبات JSON فقط: مع SameSite=Lax تمنع إرسال النماذج من مواقع أخرى
        if (!String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2_000_000) throw new HttpError(413, 'الطلب كبير جدًا');
        }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      const open = ['POST /api/auth/register', 'POST /api/auth/login', 'POST /api/auth/logout', 'GET /api/me',
        'POST /api/auth/verify', 'POST /api/auth/reset/request', 'POST /api/auth/reset'];
      const user = userFrom(req);
      if (!open.includes(`${req.method} ${url.pathname}`) && !user) throw new HttpError(401, 'سجّل الدخول أولًا');
      send(200, await route(req, res, body, user));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  }
  // يتيح للخادم معرفة صاحب الطلب (لسقف الاستخدام وتفعيل الذكاء الاصطناعي للمسجلين)
  handle.userFrom = userFrom;
  handle.isFacilitator = isFacilitator;
  return handle;
}
