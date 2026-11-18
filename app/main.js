// المتحكم: يربط الشاشات بالجلسة، ويدير التنقل والأحداث والمسودات والنوافذ.
import * as Office from './lib/office.js';
import { Session, loadWorld, setStorageKey } from './lib/session.js';
import { esc, words } from './lib/ui.js';
import * as V from './views.js';
import { agentStatus, resetAgentStatus, openMeeting, runTurn } from './lib/meeting-client.js';
import { colleagueReply } from './lib/colleague-client.js';
import { account, debouncedSaver } from './lib/account.js';
import { meetingResult, mustClose } from '../src/agents/meeting.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

let world = null;
let session = null;
let user = null;
const saver = debouncedSaver();
let verifyState = { loading: true };
let challengeState = { loading: true };
let pfState = { loading: true };        // المحرر
let pairState = { pair: null };
let pairPoll = null;
let leaguesState = { loading: true };
let workState = { loading: true, tab: 'gigs' };

async function loadWork() {
  if (!user) { workState = { error: 'سجّل الدخول لتصل إلى الأعمال الواقعية.' }; render(); return; }
  const tab = workState.tab ?? 'gigs';
  if (!workState.data) { workState = { loading: true, tab }; render(); }
  try {
    if (session) await account.saveProgress(session.saveData()).catch(() => {});
    const data = await account.work();
    const review = data.reviewer ? await account.workReview().catch(() => []) : [];
    const market = await account.market().catch(() => ({ questions: [], summary: { answered: 0, confirmed: 0, points: 0 } }));
    workState = { data, review, market, tab };
  } catch (err) { workState = { error: err.message, tab }; }
  render();
}

async function loadRealWork() {
  if (!user) { ui.realWork = null; return; }
  ui.realWork = await account.workSummary();
  render();
}
let leagueState = { league: null };

async function loadPairs() {
  if (!user) { ui.pairs = null; return; }
  ui.pairs = await account.pairsMine().catch(() => ({ pairs: [] }));
  render();
  // من ينتظر زميلًا يرى الإقران فور حدوثه
  if (ui.pairs.waiting) setTimeout(() => { if (parseRoute().page === 'team' && !parseRoute().itemId) loadPairs(); }, 5000);
}

async function loadPair() {
  clearInterval(pairPoll); pairPoll = null;
  const id = parseRoute().itemId;
  if (!user || !id) return;
  const pick = (d) => d.pairs.find((p) => p.id === id) ?? null;
  pairState.pair = pick(await account.pairsMine().catch(() => ({ pairs: [] })));
  render();
  pairPoll = setInterval(async () => {
    if (parseRoute().page !== 'pair' || parseRoute().itemId !== id) { clearInterval(pairPoll); return; }
    const next = pick(await account.pairsMine().catch(() => ({ pairs: [] })));
    if (next && pairState.pair && next.messages.length !== pairState.pair.messages.length) {
      pairState.pair = next;
      const box = app.querySelector('[data-pair-msgs]');
      if (box) { box.innerHTML = V.pairMessages(next); box.scrollTop = box.scrollHeight; }
    }
  }, 3000);
}

async function loadLeagues() {
  const id = parseRoute().itemId;
  if (!user) { render(); return; }
  if (parseRoute().page === 'leagues') {
    leaguesState = { loading: true }; render();
    leaguesState = { leagues: await account.leagues().catch(() => []) };
  } else if (id) {
    leagueState = { league: null }; render();
    try { leagueState = { league: await account.league(id) }; } catch (err) { toast(err.message, 'bad'); }
  }
  render();
}
let pfPublic = { loading: true };       // الصفحة العامة
let videoState = { loading: true };
let stopPreview = null;

async function loadVideo() {
  stopPreview?.(); stopPreview = null;
  if (!user) { videoState = { error: 'سجّل الدخول أولًا.' }; render(); return; }
  videoState = { loading: true }; render();
  try {
    const me = await account.portfolioMe();
    if (!me.portfolio?.published) throw new Error('الفيديو يُبنى من ملف أعمالك المنشور، ورابطه يظهر في آخر الفيديو للتحقق.');
    const p = await account.portfolio(me.portfolio.slug);
    const Video = await import('./lib/video.js');
    const data = { ...p, url: V.portfolioUrl(p.slug) };
    videoState = { data, slug: p.slug, Video, seconds: Video.scenes(data).total, canShareFile: false };
  } catch (err) { videoState = { error: err.message }; }
  render();
  startPreview();
}

function startPreview() {
  const canvas = app.querySelector('#video-canvas');
  if (!canvas || !videoState.data || videoState.recording) return;
  stopPreview?.();
  stopPreview = videoState.Video.preview(canvas, videoState.data);
}

async function loadPortfolio() {
  const slug = parseRoute().itemId;
  if (slug) {
    pfPublic = { loading: true }; render();
    try { pfPublic = { portfolio: await account.portfolio(slug) }; } catch (err) { pfPublic = { error: err.message }; }
    render();
    return;
  }
  if (!user) { pfState = { error: 'سجّل الدخول لبناء ملف أعمالك.' }; render(); return; }
  pfState = { loading: true }; render();
  try {
    if (session) await account.saveProgress(session.saveData()).catch(() => {});
    const data = await account.portfolioMe();
    const pf = data.portfolio;
    pfState = { data, draft: { headline: pf?.headline ?? '', displayName: pf?.displayName ?? 'first', published: pf ? pf.published : true, selections: pf?.selections ?? { deliverables: [], decisions: [], quotes: [] } } };
  } catch (err) { pfState = { error: err.message }; }
  render();
}

async function loadChallenge() {
  challengeState = { loading: true };
  render();
  try { challengeState = { challenge: await account.challenge(parseRoute().itemId) }; } catch (err) { challengeState = { error: err.message }; }
  render();
}

/** تحدياتي في صفحة التقرير: رابطي إن وُجد، وموقفي في التحدي الذي انضممت إليه. */
async function loadChallengesForReport() {
  if (!session) return;
  if (session.challenge) {
    ui.joinedChallenge = await account.challenge(session.challenge).catch(() => null);
  } else if (user) {
    ui.myChallenge = await account.myChallenge();
  }
  render();
}
let confirmState = { loading: true };
let resetState = {};
let facState = { filter: 'pending', list: [], selected: null, calibration: null, loading: true, error: '' };
let liveState = { loading: true, sessions: [], meetings: [], createEvent: null, error: '', room: null };
let livePoll = null;
let peerState = { tab: 'review', loading: true, queue: [], received: [], error: '' };

async function loadPeer() {
  if (!user) { render(); return; }
  peerState = { ...peerState, loading: true, error: '' };
  render();
  try {
    const [queue, received] = await Promise.all([account.peerQueue(), account.peerReceived()]);
    peerState = { ...peerState, queue, received, loading: false };
  } catch (err) { peerState = { ...peerState, loading: false, queue: [], error: err.message }; }
  render();
}

async function loadCollab() {
  if (!user) { ui.collab = null; return; }
  ui.collab = await account.collaboration();
  render();
}

async function loadLiveResults() {
  if (!user) { ui.liveResults = {}; return; }
  ui.liveResults = await account.liveResults();
}

async function loadLive() {
  clearInterval(livePoll); livePoll = null;
  const id = parseRoute().itemId;
  if (!user) { render(); return; }
  if (!id) {
    liveState = { ...liveState, loading: true, error: '' };
    render();
    try { const d = await account.liveList(); liveState = { ...liveState, ...d, loading: false }; } catch (err) { liveState = { ...liveState, loading: false, error: err.message }; }
    render();
    return;
  }
  try { liveState.room = await account.live(id); } catch (err) { liveState.room = null; toast(err.message, 'bad'); }
  render();
  // تحديث المحضر فقط كل ثانيتين، حتى لا يضيع ما يكتبه المستخدم
  livePoll = setInterval(async () => {
    if (parseRoute().page !== 'live' || parseRoute().itemId !== id) { clearInterval(livePoll); return; }
    try {
      const next = await account.live(id);
      const prev = liveState.room;
      liveState.room = next;
      if (!prev || prev.status !== next.status) { render(); return; }
      if (prev.messages.length !== next.messages.length) {
        const box = app.querySelector('[data-live-msgs]');
        if (box) { box.innerHTML = V.liveMessages(world, next); box.scrollTop = box.scrollHeight; }
      }
    } catch { /* انقطاع مؤقت */ }
  }, 2000);
}

async function loadFacilitator() {
  facState = { ...facState, loading: true, error: '' };
  render();
  try {
    if (facState.filter === 'peer') facState = { ...facState, peer: await account.facPeer(), loading: false };
    else {
      const [list, calibration] = await Promise.all([account.facDialogues(facState.filter), account.facCalibration()]);
      facState = { ...facState, list, calibration, loading: false };
    }
  } catch (err) { facState = { ...facState, loading: false, error: err.message }; }
  render();
}

/** يربط الجلسة بالحساب: كل حفظ محلي يُرفع إلى الخادم (مؤجلًا). */
function attach(s) {
  if (!s) return s;
  if (assess) {
    // جلسة تقييم لشركة: بلا حساب، والتقدم يُحفظ على رابط المرشح
    s.user = null; s.assess = assess.info;
    s.onSave = (data) => {
      fetch(`/api/assess/c/${assess.token}/progress`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive: JSON.stringify(data).length < 60000 })
        .then((r) => r.json()).then((d) => { if (d.finished && !assess.info.finished) { assess.info.finished = true; render(); } }).catch(() => {});
    };
    return s;
  }
  s.user = user;
  s.onSave = user ? (data) => saver.save(data) : null;
  return s;
}

// ——— جلسة التقييم للشركات ———
const SEAT_PEOPLE = new Set(['ceo', 'cfo', 'cpo', 'eng_lead', 'dev2', 'analyst', 'junior', 'mentor', 'ux', 'sales_head', 'marketing_lead', 'cs_lead']);
let assess = null;            // { token, info } حين يدخل مرشح برابط تقييم
let assessReport = { loading: true };
let assessAdmin = { loading: true };
const ASSESS_KEY = 'mohaki.assess.token';

async function enterAssess(token) {
  const res = await fetch(`/api/assess/c/${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { assess = { token, error: data.error || 'رابط التقييم غير صالح' }; render(); return; }
  try { sessionStorage.setItem(ASSESS_KEY, token); } catch { /* */ }
  assess = { token, info: data.assessment };
  user = null;
  // وكلاء الذكاء الاصطناعي يتعرفون على المرشح من رمز رابطه
  const raw = window.fetch.bind(window);
  if (!window.__assessFetch) { window.__assessFetch = true; window.fetch = (u, o = {}) => (typeof u === 'string' && u.startsWith('/api/') ? raw(u, { ...o, headers: { ...(o.headers ?? {}), 'x-assess-token': token } }) : raw(u, o)); }
  setStorageKey(`mohaki.assess.${token}`);
  world = { ...world, scenario: await (await fetch(`../data/scenarios/${data.assessment.scenario}.json`)).json() };
  refreshAgents();
  const p = assess.info.progress;
  const local = Session.localSave();
  if (assess.info.finished) session = null;
  else if (local && local.seed === assess.info.seed && (local.log?.length ?? 0) > (p?.log?.length ?? 0)) session = attach(Session.resume(world));
  else if (p) session = attach(Session.fromSave(world, p));
  if (parseRoute().page === 'assess') location.hash = session ? '#/desk' : '#/assess/' + token;
  render();
}

async function loadAssessReport() {
  assessReport = { loading: true }; render();
  try {
    const res = await fetch(`/api/assess/report/${encodeURIComponent(parseRoute().itemId)}`);
    const d = await res.json();
    assessReport = res.ok ? { report: d.report, open: assessReport.open } : { error: d.error };
  } catch (err) { assessReport = { error: err.message }; }
  render();
}

async function loadAssessAdmin() {
  assessAdmin = { loading: true }; render();
  try { const r = await fetch('/api/assess', { credentials: 'same-origin' }); const d = await r.json(); assessAdmin = r.ok ? { list: d.assessments } : { error: d.error }; } catch (err) { assessAdmin = { error: err.message }; }
  render();
}
const DRAFT_KEY = 'mohaki.drafts.v1';
let drafts = {};
try { drafts = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}'); } catch { drafts = {}; }
const saveDrafts = () => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch { /* */ } };

// الاجتماعات الجارية (تبقى عند التنقل أو إعادة التحميل حتى تُختتم)
const MEETING_KEY = 'mohaki.meetings.v1';
let meetings = {};
try { meetings = JSON.parse(sessionStorage.getItem(MEETING_KEY) || '{}'); } catch { meetings = {}; }
const saveMeetings = () => { try { sessionStorage.setItem(MEETING_KEY, JSON.stringify(meetings)); } catch { /* */ } };
const ui = { meetings, pendingMeeting: null, agentMode: 'offline', agentRoutes: {}, meetingNote: '', drafts };

function refreshAgents() {
  resetAgentStatus();
  return agentStatus().then((st) => { ui.agentMode = st.mode; ui.agentRoutes = st.routes ?? {}; if (session) render(); });
}

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [page = 'desk', id] = path.split('/');
  const params = new URLSearchParams(query);
  const extra = ['account', 'verify', 'confirm-email', 'reset-password', 'facilitator', 'live', 'peer', 'challenge', 'portfolio', 'video', 'pair', 'leagues', 'league', 'profile', 'assess', 'assess-report', 'assessments'];
  // "أعمال واقعية" في القائمة الرئيسية (NAV)
  return { page: V.NAV.some((n) => n.id === page) || extra.includes(page) ? page : 'desk', itemId: id ? decodeURIComponent(id) : null, filter: params.get('f') || 'open' };
}

function render() {
  const route = parseRoute();
  // صفحة التحقق عامة: تعمل دون حساب ودون جلسة
  if (route.page === 'verify') {
    app.innerHTML = V.verifyPage(verifyState);
    document.title = verifyState.record?.name ? `سجل ${verifyState.record.name} — محاكي` : 'التحقق من سجل — محاكي';
    return;
  }
  if (route.page === 'portfolio' && route.itemId) {
    app.innerHTML = V.portfolioPage(pfPublic);
    document.title = pfPublic.portfolio ? `${pfPublic.portfolio.name} — ملف أعمال موثّق · محاكي` : 'ملف أعمال — محاكي';
    return;
  }
  if (route.page === 'assess-report') { app.innerHTML = V.assessReportPage(assessReport); document.title = 'تقرير التقييم — محاكي'; return; }
  if (route.page === 'assessments' && !assess) { app.innerHTML = `<div class="content" style="margin:0 auto">${V.assessAdminPage(user, assessAdmin)}</div>`; return; }
  if (assess) {
    document.title = 'جلسة تقييم — محاكي';
    if (assess.error || assess.info.finished || !session) { app.innerHTML = V.assessGate(assess); return; }
    if (session.sim.finished) { app.innerHTML = V.assessGate({ ...assess, info: { ...assess.info, finished: true } }); return; }
  }
  if (route.page === 'challenge') {
    app.innerHTML = V.challengePage(challengeState, { session, user });
    document.title = challengeState.challenge ? `تحدٍّ من ${challengeState.challenge.owner.name} — محاكي` : 'تحدٍّ — محاكي';
    return;
  }
  if (route.page === 'confirm-email') { app.innerHTML = V.confirmEmailPage(confirmState); document.title = 'تأكيد البريد — محاكي'; return; }
  if (route.page === 'reset-password') { app.innerHTML = V.resetPasswordPage(resetState); document.title = 'كلمة مرور جديدة — محاكي'; return; }
  if (route.page === 'work' && user && !session) {
    app.innerHTML = `<div class="content" style="margin:0 auto">${V.workPage(workState, route.itemId)}</div>`;
    return;
  }
  if (['leagues', 'league'].includes(route.page) && user && !session) {
    app.innerHTML = `<div class="content" style="margin:0 auto">${route.page === 'leagues' ? V.leaguesPage(user, leaguesState) : V.leaguePage(leagueState.league)}</div>`;
    return;
  }
  if (route.page === 'peer' && user && !session) {
    app.innerHTML = `<div class="content" style="margin:0 auto">${V.peerPage(user, peerState)}</div>`;
    return;
  }
  if (route.page === 'live' && user && !session) {
    app.innerHTML = `<div class="content" style="margin:0 auto">${route.itemId && liveState.room ? V.liveRoom(world, liveState.room, { drafts }) : V.livePage(user, liveState)}</div>`;
    const box = app.querySelector('[data-live-msgs]'); if (box) box.scrollTop = box.scrollHeight;
    return;
  }
  if (route.page === 'facilitator' && user?.role === 'facilitator' && !session) {
    app.innerHTML = `<div class="content" style="margin:0 auto">${V.facilitatorPage(world, facState)}</div>`;
    return;
  }
  if (!session) {
    app.innerHTML = route.page === 'account' && user
      ? `<div class="content" style="margin:0 auto">${V.accountPage(null, user)}<p><a href="#/desk">← العودة</a></p></div>`
      : V.welcome(world, Session.hasSave(), user);
    document.title = 'محاكي — ابدأ يومك الوظيفي';
    return;
  }
  let body;
  switch (route.page) {
    case 'inbox':
      if (route.itemId) session.markOpened(route.itemId);
      body = V.inbox(session, route, drafts, { ...ui, meetings, drafts }); break;
    case 'team': body = route.itemId
      ? V.colleagueChat(session, session.person(route.itemId), { ...ui, drafts })
      : V.team(session, ui); break;
    case 'meetings': body = V.meetings(session); break;
    case 'files': body = V.files(session); break;
    case 'library':
      // فتح المستند يعني قراءته (معلومة للواجهة فقط)
      if (route.itemId && V.libraryDocs(session).some((d) => d.id === route.itemId) && !session.read?.[route.itemId]) session.markRead(route.itemId);
      body = V.library(session, route.itemId); break;
    case 'company': body = V.company(session); break;
    case 'feed': body = V.feed(session); break;
    case 'report': body = V.report(session, ui); break;
    case 'portfolio': body = V.portfolioEditor(pfState); break;
    case 'video': body = V.videoPage(videoState); break;
    case 'pair': body = V.pairChat(pairState.pair); break;
    case 'leagues': body = user ? V.leaguesPage(user, leaguesState) : '<section class="card"><div class="empty"><b>سجّل الدخول للدوري</b></div></section>'; break;
    case 'league': body = V.leaguePage(leagueState.league); break;
    case 'work': body = V.workPage(workState, route.itemId); break;
    case 'profile': body = V.profilePage(user); break;
    case 'plan': body = V.planPage(session, session.planExtra ?? {}); break;
    case 'peer': body = user ? V.peerPage(user, peerState) : '<section class="card"><div class="empty"><b>سجّل الدخول لمراجعة مستندات زملائك</b></div></section>'; break;
    case 'account': body = V.accountPage(session, user); break;
    case 'live': body = !user ? '<section class="card"><div class="empty"><b>سجّل الدخول للانضمام إلى الجلسات الحية</b></div></section>'
      : route.itemId && liveState.room ? V.liveRoom(world, liveState.room, { drafts }) : V.livePage(user, liveState); break;
    case 'facilitator': body = user?.role === 'facilitator' ? V.facilitatorPage(world, facState) : '<section class="card"><div class="empty"><b>هذه الصفحة للمُيسِّرين فقط</b></div></section>'; break;
    default: body = V.desk(session);
  }
  const keepScroll = route.page === 'inbox' ? window.scrollY : 0;
  app.innerHTML = V.shell(session, route, body);
  if (route.page === 'video' && videoState.data && !videoState.recording) startPreview();
  // المكتب الحي: بطاقة كبيرة في "مكتبي"، ونافذة صغيرة في بقية الصفحات
  const officeEl = app.querySelector('#office') || app.querySelector('#office-mini');
  if (officeEl) { Office.mount(officeEl, session, ui.officeScene); ui.officeScene = null; }
  const nav = V.NAV.find((n) => n.id === route.page);
  document.title = `${nav?.label ?? 'مكتبي'} · NOVA TECH — محاكي`;
  window.scrollTo(0, keepScroll);
  const box = app.querySelector('[data-minutes]');
  if (box) box.scrollTop = box.scrollHeight;
}

function toast(text, tone = 'info') {
  if (!text) return;
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = text;
  toastRoot.append(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  setTimeout(() => el.remove(), 5200);
}

function openModal(html) {
  modalRoot.innerHTML = `<div class="modal-back" data-act="backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  (modalRoot.querySelector('.modal input:not([type=checkbox]), .modal textarea') ?? modalRoot.querySelector('.modal button, .modal a'))?.focus();
}
function closeModal() { modalRoot.innerHTML = ''; }

/** أول ما يراه المتدرب الجديد: سؤال الهدف، ثم الجولة. (يُتجاوز في الفحوص الآلية.) */
function askGoalThenTour() {
  if (!session || session.assess || session.goal || navigator.webdriver) { maybeTour(); return; }
  openModal(V.goalModal());
}

/** ما تحتاجه الخطة من الخادم: هل نُشر ملف الأعمال؟ وكم عملًا واقعيًا وبحث سوق معتمدًا؟ */
async function loadPlanExtra() {
  if (!session || !user) return;
  const [w, pf] = await Promise.all([account.workSummary(), account.portfolioMe().catch(() => null)]);
  session.planExtra = { realWork: w?.count ?? 0, market: w?.market?.confirmed ?? 0, portfolioPublished: !!pf?.portfolio?.published };
  if (['plan', 'desk'].includes(parseRoute().page)) render();
}

/** الجولة التعريفية تبدأ تلقائيًا أول مرة. (تُتجاهل في الفحوص الآلية حتى لا تحجب النقرات، ولها فحص خاص.) */
async function maybeTour() {
  if (navigator.webdriver) return;
  const t = await import('./lib/tour.js');
  if (!t.tourSeen()) setTimeout(t.startTour, 500);
}

/**
 * سؤال مهارة عشوائي خلال اليوم: بعد إنجاز بند، مرتين في يوم العمل كحد أقصى.
 * يميل إلى أضعف مهارات المتدرب، ولا يكرر سؤالًا أُجيب.
 */
function showQuiz(force = false) {
  if (!session || session.assess || session.sim.finished || modalRoot.innerHTML) return;
  const left = (world.quiz?.questions ?? []).filter((q) => !(q.id in session.quiz));
  if (!left.length) { if (force) toast('أجبت كل الأسئلة. أحسنت!', 'good'); return; }
  if (!force && ((session.quizDay[session.sim.day] ?? 0) >= 2 || Math.random() > 0.45 || navigator.webdriver)) return;
  const weak = new Set(session.sim.report().skills.filter((s) => s.score !== null).sort((a, b) => a.score - b.score).slice(0, 3).map((s) => s.id));
  const pool = left.filter((q) => weak.has(q.skill));
  const from = pool.length && Math.random() < 0.7 ? pool : left;
  ui.quizQ = from[Math.floor(Math.random() * from.length)];
  openModal(V.quizModal(world, ui.quizQ));
}
const quizSoon = () => setTimeout(() => showQuiz(), 2500);

function nextOpenItemHref() {
  const next = session.sim.inbox()[0];
  return next ? `#/inbox/${encodeURIComponent(next.id)}` : '#/inbox?f=open';
}

// ——— الأفعال ———

const actions = {
  start() {
    Session.clear();
    session = null;
    drafts = {}; saveDrafts();
    for (const k of Object.keys(meetings)) delete meetings[k];
    saveMeetings();
    session = attach(Session.start(world));
    if (user) saver.save(session.saveData());
    location.hash = '#/desk';
    render();
    askGoalThenTour();
  },
  resume() {
    session = attach(Session.resume(world));
    if (!location.hash) location.hash = '#/desk';
    render();
  },
  reset() { openModal(V.resetConfirm()); },
  'confirm-reset'() { closeModal(); session = null; actions.start(); },
  'end-day'() {
    // الضيف يجرب يومه الأول، ثم يُطلب منه إنشاء حساب ليكمل (تقدمه محفوظ وينتقل للحساب)
    if (!user && !session.assess && session.sim.day >= 2) { openModal(V.guestWall()); return; }
    openModal(V.endDayConfirm(session));
  },
  'open-auth'(e) { openModal(V.authModal(e.target.closest('[data-mode]').dataset.mode)); },
  async logout() {
    await account.logout().catch(() => {});
    user = null;
    refreshAgents();
    Session.clear(); // جهاز مشترك: لا يبقى تقدم الحساب في المتصفح بعد الخروج
    session = null;
    location.hash = '';
    render();
    toast('سُجّل خروجك.');
  },
  'delete-account'() { openModal(V.deleteConfirm()); },
  'open-forgot'() { openModal(V.forgotModal()); },
  async 'video-record'() {
    stopPreview?.(); stopPreview = null;
    if (videoState.file) URL.revokeObjectURL(videoState.file.url);
    Object.assign(videoState, { recording: true, progress: 0, file: null });
    render();
    const canvas = app.querySelector('#video-canvas');
    let last = 0;
    try {
      const out = await videoState.Video.record(canvas, videoState.data, {
        maxSeconds: window.__mohakiVideoSeconds, // للاختبار الآلي فقط
        onProgress: (p) => {
          videoState.progress = p;
          if (p - last > 0.02) { last = p; const el = app.querySelector('.bar-wrap'); if (el) el.innerHTML = `<div class="small">جارٍ التسجيل… ${Math.round(p * 100)}%</div>${V.progressBar(p * 100)}`; }
        },
      });
      const file = new File([out.blob], `mohaki-${videoState.slug}.${out.ext}`, { type: out.blob.type });
      videoState.file = { ...out, url: URL.createObjectURL(out.blob), file };
      session?.markVideo();
      videoState.canShareFile = !!navigator.canShare?.({ files: [file] });
    } catch (err) { toast(err.message, 'bad'); }
    videoState.recording = false;
    render();
    startPreview();
  },
  async 'video-share'() {
    try { await navigator.share({ files: [videoState.file.file], title: 'شهري في NOVA TECH', text: `30 يومًا مدير منتجات في شركة افتراضية. أعمالي موثّقة: ${videoState.data.url}` }); } catch { /* أُلغي */ }
  },
  'ack-read'(e) {
    const itemId = e.target.closest('[data-item]').dataset.item;
    const item = session.sim.items.find((i) => i.id === itemId);
    const opt = session.respond(itemId, item.options[0].id, '');
    ui.officeScene = { kind: 'reply', from: item.from };
    toast(opt.result || 'تم.', 'good');
    location.hash = nextOpenItemHref();
    render();
  },
  'report-insight'(e) {
    const x = session.insight(e.target.closest('[data-id]').dataset.id);
    ui.officeScene = { kind: 'insight', to: x.to };
    toast(x.result || 'وصلت ملاحظتك.', 'good');
    render();
  },
  'quiz-answer'(e) {
    const i = Number(e.target.closest('[data-i]').dataset.i);
    const q = ui.quizQ;
    session.answerQuiz(q.id, i === q.answer);
    openModal(V.quizModal(world, q, i));
  },
  'quiz-now'() { showQuiz(true); },
  async 'assess-start'() {
    const ok = app.querySelector('#assess-consent')?.checked;
    if (!ok) { toast('نحتاج موافقتك لبدء الجلسة.', 'bad'); return; }
    const res = await fetch(`/api/assess/c/${assess.token}/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
    const d = await res.json();
    if (!res.ok) { toast(d.error, 'bad'); return; }
    assess.info = d.assessment;
    Session.clear();
    session = attach(Session.start(world, assess.info.seed));
    session._persist();
    location.hash = '#/desk';
    render();
    maybeTour();
  },
  'assess-toggle'(e) { const i = e.target.closest('[data-i]').dataset.i; assessReport.open = assessReport.open === i ? null : i; render(); },
  'research-ask'(e) {
    const el = e.target.closest('[data-source]');
    const r = session.investigate(el.dataset.item, el.dataset.source);
    toast(r.pending ? `طلبت التحليل. يجهز بعد ${r.delay} ساعات عمل.` : r.data ? 'وصلتك معلومة.' : 'لا معلومة عنده، لكنه دلّك على اتجاه.', r.data || r.pending ? 'good' : undefined);
    if (SEAT_PEOPLE.has(el.dataset.source)) ui.officeScene = { kind: 'insight', to: el.dataset.source };
    render();
  },
  'work-hour'() { session.wait(); toast('مرّت ساعة عمل.', 'good'); render(); },
  'edit-goal'() { openModal(V.goalModal(session.goal)); },
  async tour() { (await import('./lib/tour.js')).startTour(); },
  'work-tab'(e) { workState.tab = e.target.closest('[data-tab]').dataset.tab; location.hash = '#/work'; render(); },
  async 'work-withdraw'(e) {
    if (!confirm('الانسحاب من هذه الفرصة؟')) return;
    try { await account.workWithdraw(e.target.closest('[data-app]').dataset.app); toast('تم الانسحاب.', 'good'); } catch (err) { toast(err.message, 'bad'); }
    loadWork();
  },
  async 'work-decide'(e) {
    const el = e.target.closest('[data-app]');
    try { await account.workDecide(el.dataset.app, { action: el.dataset.action }); toast('تم.', 'good'); } catch (err) { toast(err.message, 'bad'); }
    loadWork();
  },
  async 'pair-request'() {
    try { const r = await account.pairRequest(); toast(r.pair ? `زميلك الجديد: ${r.pair.partner}` : 'نبحث لك عن زميل. سنقرنك بأول متدرب يطلب زميلًا.', 'good'); } catch (err) { toast(err.message, 'bad'); }
    loadPairs();
  },
  async 'pair-cancel'() { await account.pairCancel().catch(() => {}); loadPairs(); },
  async 'toggle-ai'(e) {
    try {
      user = await account.update({ consents: { aiTraining: e.target.checked } });
      if (session) session.user = user;
      toast(e.target.checked ? 'شكرًا. تُستخدم محادثاتك (دون اسمك) لتحسين المحاكاة إذا وافق زميلك أيضًا.' : 'سُحبت الموافقة.', 'good');
    } catch (err) { toast(err.message, 'bad'); }
    render();
  },
  'league-join'(e) {
    const el = e.target.closest('[data-id]');
    const seed = Number(el.dataset.seed);
    if (session && session.log.length && !confirm('سيبدأ شهر الدوري ويحلّ محل تقدمك الحالي. متابعة؟')) return;
    Session.clear();
    drafts = {}; saveDrafts();
    for (const k of Object.keys(meetings)) delete meetings[k];
    saveMeetings();
    session = attach(Session.start(world, seed, { league: el.dataset.id }));
    if (user) saver.save(session.saveData());
    toast('بدأ شهر الدوري: نفس الشركة والأحداث لكل الفرق. بالتوفيق!', 'good');
    location.hash = '#/desk';
  },
  async 'copy-url'(e) {
    const url = e.target.closest('[data-url]').dataset.url;
    try { await navigator.clipboard.writeText(url); toast('نُسخ الرابط.', 'good'); } catch { prompt('انسخ الرابط:', url); }
  },
  async 'pf-delete'() {
    if (!confirm('حذف ملف الأعمال وإيقاف رابطه نهائيًا؟')) return;
    try { await account.portfolioDelete(); toast('حُذف الملف وتوقف الرابط.', 'good'); loadPortfolio(); } catch (err) { toast(err.message, 'bad'); }
  },
  async 'create-challenge'() {
    try {
      // لا بد أن يكون آخر تقدم على الخادم قبل حساب نقاط صاحب التحدي
      await account.saveProgress(session.saveData());
      ui.myChallenge = await account.challengeCreate();
      toast('رابط التحدي جاهز. شاركه مع أصدقائك.', 'good');
    } catch (err) { toast(err.message, 'bad'); }
    render();
  },
  async 'share-challenge'(e) {
    const code = e.target.closest('[data-code]').dataset.code;
    const url = V.challengeUrl(code);
    if (navigator.share) { try { await navigator.share({ title: 'تحداني في محاكي', url }); return; } catch { /* أُلغي */ } }
    actions['copy-challenge'](e);
  },
  async 'copy-challenge'(e) {
    const url = V.challengeUrl(e.target.closest('[data-code]').dataset.code);
    try { await navigator.clipboard.writeText(url); toast('نُسخ الرابط.', 'good'); } catch { prompt('انسخ الرابط:', url); }
  },
  async 'revoke-challenge'(e) {
    if (!confirm('إلغاء رابط التحدي؟ سيتوقف الرابط عن العمل لكل من لديه.')) return;
    try { await account.challengeRevoke(e.target.closest('[data-code]').dataset.code); ui.myChallenge = null; toast('أُلغي الرابط.', 'good'); } catch (err) { toast(err.message, 'bad'); }
    render();
  },
  'accept-challenge'(e) {
    const c = challengeState.challenge;
    if (session && session.log.length && session.challenge !== c.code && !confirm(`سيبدأ شهر جديد بعالم ${c.owner.name} ويحلّ محل تقدمك الحالي (اليوم ${session.sim.day}). متابعة؟`)) return;
    Session.clear();
    drafts = {}; saveDrafts();
    for (const k of Object.keys(meetings)) delete meetings[k];
    saveMeetings();
    session = attach(Session.start(world, c.seed, { challenge: c.code }));
    if (user) saver.save(session.saveData());
    toast(`بدأ التحدي. نفس عالم ${c.owner.name} بالضبط. بالتوفيق!`, 'good');
    location.hash = '#/desk';
    maybeTour();
  },
  'peer-tab'(e) { peerState.tab = e.target.closest('[data-tab]').dataset.tab; peerState.error = ''; render(); },
  async 'peer-helpful'(e) {
    const el = e.target.closest('[data-id]');
    try { await account.peerFeedback({ reviewId: el.dataset.id, helpful: el.dataset.v === '1' }); peerState.received = await account.peerReceived(); render(); } catch (err) { toast(err.message, 'bad'); }
  },
  async 'peer-report'(e) {
    if (!confirm('إبلاغ المُيسِّر بأن هذه المراجعة غير مهنية؟')) return;
    try { await account.peerFeedback({ reviewId: e.target.closest('[data-id]').dataset.id, report: true, helpful: false }); peerState.received = await account.peerReceived(); toast('أُبلغ المُيسِّر.', 'good'); render(); } catch (err) { toast(err.message, 'bad'); }
  },
  async 'peer-moderate'(e) {
    const el = e.target.closest('[data-id]');
    const hide = el.dataset.hide === '1';
    const reason = hide ? prompt('سبب الإخفاء (يظهر في سجل الإشراف):', 'غير مهنية') : '';
    if (hide && reason === null) return;
    try { await account.facModerate({ reviewId: el.dataset.id, hidden: hide, reason }); loadFacilitator(); } catch (err) { toast(err.message, 'bad'); }
  },
  async 'toggle-digest'(e) {
    try {
      user = await account.update({ prefs: { dailyDigest: e.target.checked } });
      if (session) session.user = user;
      toast(e.target.checked ? 'سيصلك ملخص يومي على بريدك بعد كل يوم عمل.' : 'أُوقف الملخص اليومي.', 'good');
    } catch (err) { toast(err.message, 'bad'); }
    render();
  },
  async 'toggle-peer'(e) {
    try {
      user = await account.update({ consents: { peerReview: e.target.checked } });
      if (session) session.user = user;
      toast(e.target.checked ? 'ستُعرض مستنداتك على زملائك للمراجعة دون اسمك.' : 'لن تُكلَّف مستنداتك لمراجعات جديدة.', 'good');
    } catch (err) { toast(err.message, 'bad'); }
    render();
  },
  async 'live-start'(e) {
    try { liveState.room = await account.liveStart(e.target.closest('[data-id]').dataset.id); render(); } catch (err) { toast(err.message, 'bad'); }
  },
  'apply-live'(e) {
    const itemId = e.target.closest('[data-item]').dataset.item;
    const item = session.sim.items.find((i) => i.id === itemId);
    const r = ui.liveResults[item.eventId];
    const said = r.transcript.filter((l) => l.speaker === 'trainee').map((l) => l.text).join('\n');
    const opt = session.respond(itemId, r.optionId, said, { transcript: r.transcript, addressed: r.addressed, mode: 'human' });
    toast(`اعتُمدت نتيجة الجلسة الحية: ${opt.label}`, 'good');
    render();
  },
  'fac-filter'(e) { facState.filter = e.target.closest('[data-filter]').dataset.filter; facState.selected = null; loadFacilitator(); },
  'fac-select'(e) { facState.selected = e.target.closest('[data-key]').dataset.key; facState.error = ''; render(); },
  'fac-export'() {
    const blob = new Blob([JSON.stringify(facState.calibration.dataset, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `mohaki-calibration-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    URL.revokeObjectURL(a.href);
  },
  async 'resend-verification'() {
    try {
      const r = await account.resendVerification();
      toast(r.alreadyVerified ? 'بريدك مؤكد بالفعل.' : `أرسلنا رابط التأكيد إلى ${user.email}.`, 'good');
    } catch (err) { toast(err.message, 'bad'); }
  },
  async 'confirm-delete'() {
    await account.remove();
    closeModal();
    user = null; Session.clear(); session = null;
    location.hash = '';
    render();
    toast('حُذف حسابك وبياناتك.', 'good');
  },
  async 'toggle-sharing'(e) {
    try {
      user = await account.update({ consents: { employerSharing: e.target.checked } });
      if (session) session.user = user;
      toast(e.target.checked ? 'فُعّلت مشاركة سجلك مع جهات التوظيف الشريكة.' : 'سُحبت موافقة المشاركة.', 'good');
    } catch (err) { toast(err.message, 'bad'); }
    render();
  },
  async 'issue-record'() {
    try {
      await saver.flush();
      await account.saveProgress(session.saveData());
      const rec = await account.issueRecord();
      session.issuedRecord = rec;
      user = await account.me(); session.user = user;
      toast(`صدر سجلك الموثّق ${rec.code}`, 'good');
      render();
    } catch (err) { toast(err.message, 'bad'); }
  },
  async 'copy-verify'(e) {
    const url = `${location.origin}${location.pathname}#/verify/${e.target.closest('[data-code]').dataset.code}`;
    try { await navigator.clipboard.writeText(url); toast('نُسخ رابط التحقق.', 'good'); } catch { toast(url); }
  },
  'confirm-end-day'() {
    const day = session.sim.day;
    session.endDay();
    render();
    openModal(V.daySummary(session, day));
  },
  'close-modal'() { closeModal(); },
  'join-meeting'(e) {
    const id = e.target.closest('[data-item]').dataset.item;
    const item = session.sim.items.find((i) => i.id === id);
    // لا يبدأ حوارًا لا تكفي ساعات اليوم لإتمامه
    if (!session.sim.canAfford(session.sim.costOf(item))) { toast('لا تكفي ساعات اليوم لهذا البند. أنهِ يوم العمل وأكمل غدًا.', 'bad'); return; }
    meetings[id] = openMeeting(item);
    saveMeetings();
    render();
  },
  suggest(e) {
    const ta = app.querySelector('#msg');
    if (ta && !ta.disabled) { ta.value = e.target.closest('[data-text]').dataset.text; ta.focus(); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  },
  'close-meeting'(e) { closeMeeting(e.target.closest('[data-item]').dataset.item); },
  backdrop(e) { if (e.target.classList.contains('modal-back')) closeModal(); },
  'go-report'() { closeModal(); location.hash = '#/report'; },
  print() { window.print(); },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) { e.preventDefault(); guard(() => actions[el.dataset.act](e)); }
});
modalRoot.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) guard(() => actions[el.dataset.act](e));
});
/** أخطاء المحرك (مثل انتهاء ساعات اليوم) تظهر للمتدرب رسالةً لا عطلًا صامتًا. */
function guard(fn) {
  try { const r = fn(); if (r?.catch) r.catch((err) => { toast(err.message, 'bad'); render(); }); } catch (err) { toast(err.message, 'bad'); render(); }
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalRoot.innerHTML) closeModal(); });

app.addEventListener('change', (e) => {
  if (e.target.dataset.actChange === 'pf-pick') {
    const { key } = e.target.dataset;
    const list = pfState.draft.selections[key];
    const i = list.indexOf(e.target.value);
    if (e.target.checked && i < 0) list.push(e.target.value);
    if (!e.target.checked && i >= 0) list.splice(i, 1);
    // نحفظ ما كُتب في الإعدادات قبل إعادة الرسم
    const form = app.querySelector('form[data-form="portfolio"]');
    if (form) pfState.draft.headline = form.headline.value;
    const y = window.scrollY; render(); window.scrollTo(0, y);
    return;
  }
  if (e.target.dataset.actChange === 'live-event') {
    // نحفظ ما أُدخل قبل إعادة الرسم، ثم نعيد ملء الحقول المشتركة
    const form = e.target.closest('form');
    const keep = { presenterEmail: form.presenterEmail.value, scheduledAt: form.scheduledAt.value };
    liveState.createEvent = e.target.value;
    render();
    const f2 = app.querySelector('form[data-form="live-create"]');
    if (f2) { f2.presenterEmail.value = keep.presenterEmail; f2.scheduledAt.value = keep.scheduledAt; }
  }
});

// المسودات: لا يضيع ما كتبه المتدرب عند التنقل بين البنود
app.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.draft) {
    const id = t.dataset.draft;
    if (t.dataset.draftField) {
      drafts[id] = { ...(typeof drafts[id] === 'object' ? drafts[id] : {}), [t.dataset.draftField]: t.value };
    } else {
      drafts[id] = t.value;
      const wc = t.closest('form')?.querySelector('[data-wc]');
      if (wc) wc.textContent = `${words(t.value)} كلمة`;
    }
    saveDrafts();
  }
  if (t.name === 'option') {
    const id = t.closest('form').dataset.item;
    drafts[id] = { ...(typeof drafts[id] === 'object' ? drafts[id] : {}), option: t.value };
    saveDrafts();
  }
});

async function meetingStep(itemId, message, { closing = false } = {}) {
  const item = session.sim.items.find((i) => i.id === itemId);
  if (!item || item.status !== 'open' || !meetings[itemId]) return;
  ui.pendingMeeting = itemId;
  ui.meetingNote = '';
  render();
  try {
    const out = await runTurn(session.sim, item, meetings[itemId], message, { closing });
    meetings[itemId] = out.meeting;
    if (out.fellBack) ui.meetingNote = 'تعذر الوصول إلى Claude، فأكمل الوضع المحلي هذه الجولة.';
    if (message && drafts[itemId]) { delete drafts[itemId].say; saveDrafts(); }
    saveMeetings();
  } finally {
    ui.pendingMeeting = null;
  }
  if (meetings[itemId].closed) {
    const r = meetingResult(meetings[itemId]);
    const opt = session.respond(itemId, r.optionId, r.rationale, { transcript: r.transcript, addressed: r.addressed, mode: r.mode });
    delete meetings[itemId]; saveMeetings();
    delete drafts[itemId]; saveDrafts();
    const isChat = item.dialogue.mode === 'chat';
    ui.officeScene = isChat ? { kind: 'reply', from: item.dialogue.chair } : { kind: 'meeting', people: item.dialogue.participants };
    quizSoon();
    const good = r.addressed.length >= Math.min(2, item.dialogue.concerns.length);
    toast(`${isChat ? 'انتهت المحادثة' : 'انتهى الاجتماع'}: ${opt.label}`, good ? 'good' : 'bad');
    render();
    return;
  }
  render();
  if (mustClose(meetings[itemId])) closeMeeting(itemId);
  else app.querySelector('#say')?.focus();
}

async function submitAuth(form) {
  const f = new FormData(form);
  const register = form.dataset.mode === 'register';
  user = register
    ? await account.register({
      name: f.get('name'), email: f.get('email'), password: f.get('password'),
      profile: { university: f.get('university'), major: f.get('major'), graduationYear: f.get('graduationYear'), city: f.get('city') },
      consents: { processing: f.get('processing') === 'on', employerSharing: f.get('employerSharing') === 'on', peerReview: f.get('peerReview') === 'on' },
    })
    : await account.login(f.get('email'), f.get('password'));
  closeModal();
  // الدخول لحساب له تقدم سابق: يُعتمد تقدم الحساب. وإلا يُرفع تقدم الضيف الحالي إلى الحساب.
  const remote = register ? null : await account.progress().catch(() => null);
  if (remote) session = attach(Session.fromSave(world, remote));
  else if (session) { attach(session); await account.saveProgress(session.saveData()); }
  refreshAgents();
  loadLiveResults().then(render);
  if (parseRoute().page === 'live') loadLive();
  if (parseRoute().page === 'peer') loadPeer();
  toast(register ? `أهلًا ${user.name}! حسابك جاهز وتقدمك محفوظ.` : `مرحبًا بعودتك ${user.name}.`, 'good');
  render();
}

async function sendToColleague(personId, message) {
  const person = session.person(personId);
  const day = session.sim.day;
  session.addMessages(personId, [{ speaker: 'trainee', text: message, day }]);
  delete drafts[`colleague:${personId}`]; saveDrafts();
  ui.pendingColleague = personId;
  ui.colleagueNote = '';
  render();
  const out = await colleagueReply(session, person, message);
  session.addMessages(personId, [{ speaker: personId, text: out.reply, day, mode: out.mode }]);
  if (out.fellBack) ui.colleagueNote = 'تعذر الوصول إلى Claude، فأجاب الوضع المحلي.';
  ui.pendingColleague = null;
  render();
  app.querySelector('#msg')?.focus();
}

function closeMeeting(itemId) {
  meetingStep(itemId, '', { closing: true }).catch((err) => { console.error(err); toast(err.message, 'bad'); render(); });
}

function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const itemId = form.dataset.item;
  if (form.dataset.form === 'goal') {
    const f = new FormData(form);
    const first = !session.goal;
    session.setGoal({ role: f.get('role'), need: f.get('need') });
    closeModal();
    toast('بُنيت خطتك. تجدها في "خطتي".', 'good');
    render();
    if (first) maybeTour();
    return;
  }
  if (form.dataset.form === 'research') {
    const answers = Object.fromEntries(new FormData(form).entries());
    const r = session.research(itemId, answers);
    ui.officeScene = { kind: 'deliver' };
    toast(r.good ? 'جوابك صحيح ومدعوم بالمصادر.' : 'الجواب لم يصمد أمام الأرقام.', r.good ? 'good' : 'bad');
    render(); quizSoon();
    return;
  }
  if (form.dataset.form === 'assess-new') {
    const f = new FormData(form);
    const candidates = String(f.get('candidates') || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(.*?)[,،\s]+(\S+@\S+)$/); return m ? { name: m[1].trim(), email: m[2] } : { name: l }; });
    fetch('/api/assess', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: f.get('company'), role: f.get('role'), title: f.get('title'), minutes: Number(f.get('minutes')), candidates }) })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); toast('أُنشئ التقييم. انسخ الروابط وأرسلها.', 'good'); loadAssessAdmin(); })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'trainee-profile') {
    account.update({ profile: Object.fromEntries(new FormData(form).entries()) })
      .then((u) => { user = u; if (session) session.user = u; toast('حُفظت صفحتك.', 'good'); render(); })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'market-answer') {
    const f = new FormData(form);
    account.marketAnswer(form.dataset.id, { value: f.get('value'), sourceUrl: f.get('sourceUrl'), note: f.get('note') })
      .then(() => { toast('وصلت إجابتك. تُعتمد إذا طابقت إجابات زملائك من مصادر مختلفة.', 'good'); loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'market-new') {
    account.marketCreate(Object.fromEntries(new FormData(form).entries()))
      .then(() => { toast('نُشر السؤال.', 'good'); loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'market-confirm') {
    account.marketConfirm(form.dataset.id, new FormData(form).get('value'))
      .then(() => { toast('حُسم الجواب.', 'good'); loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'work-apply') {
    account.workApply(form.dataset.id, String(new FormData(form).get('note') || ''))
      .then(() => { toast('وصل طلبك. سيراجعه المسؤول عن الفرصة.', 'good'); loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'work-submit') {
    const f = new FormData(form);
    account.workSubmit(form.dataset.app, { text: f.get('text'), link: f.get('link') })
      .then(() => { toast('سُلِّم العمل. يصلك التقييم بعد المراجعة.', 'good'); loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'work-review') {
    const f = new FormData(form);
    const action = e.submitter?.value || 'approve';
    account.workDecide(form.dataset.app, { action, rating: Number(f.get('rating')), feedback: f.get('feedback') })
      .then(() => { toast('تم حفظ المراجعة.', 'good'); loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'work-new') {
    const f = Object.fromEntries(new FormData(form).entries());
    account.workCreate(f).then(() => { toast('نُشرت الفرصة.', 'good'); workState.tab = 'gigs'; loadWork(); }).catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'pair-say') {
    const text = String(new FormData(form).get('text') || '').trim();
    if (!text) return;
    account.pairSay(form.dataset.id, text).then((p) => { pairState.pair = p; render(); app.querySelector('#pair-msg')?.focus(); const box = app.querySelector('[data-pair-msgs]'); if (box) box.scrollTop = box.scrollHeight; })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'league-create') {
    const f = new FormData(form);
    const teams = [1, 2, 3, 4].map((i) => ({ name: f.get(`team${i}`), emails: String(f.get(`emails${i}`) || '').split(/[\s,،]+/).filter(Boolean) })).filter((t) => t.emails.length);
    const rounds = [1, 2, 3].map((i) => ({ title: f.get(`rt${i}`), untilDay: Number(f.get(`rd${i}`)), deadline: f.get(`rx${i}`) || undefined })).filter((r) => r.title && r.untilDay);
    account.leagueCreate({ name: f.get('name'), teams, rounds })
      .then((l) => { toast('أُنشئ الدوري.', 'good'); location.hash = `#/league/${l.id}`; })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'delegate') {
    const itemId = form.dataset.item;
    const brief = String(new FormData(form).get('brief') || '').trim();
    if (words(brief) < 5) { toast('اكتب تكليفًا واضحًا: الهدف، والمطلوب، والموعد.', 'bad'); return; }
    const r = session.delegate(itemId, brief);
    delete drafts[`delegate:${itemId}`]; saveDrafts();
    ui.officeScene = { kind: 'delegate', to: session.sim.items.find((i) => i.id === itemId).delegable.to };
    toast(`أُرسل التكليف. يعود يوم ${r.returnDay}.`, 'good');
    render();
    return;
  }
  if (form.dataset.form === 'portfolio') {
    const f = new FormData(form);
    const d = pfState.draft;
    d.headline = String(f.get('headline') || '');
    d.displayName = f.get('displayName');
    d.published = f.get('published') === 'on';
    account.portfolioSave(d)
      .then((data) => { pfState.data = data; pfState.draft.selections = data.portfolio.selections; toast(d.published ? 'حُفظ ملفك ونُشر.' : 'حُفظ ملفك (غير منشور).', 'good'); render(); })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'peer-review') {
    const f = new FormData(form);
    const sections = {};
    for (const [k, v] of f.entries()) if (k.startsWith('sec:')) sections[k.slice(4)] = v;
    account.peerReview({ assignmentId: form.dataset.id, sections, strengths: f.get('strengths'), improve: f.get('improve'), overall: Number(f.get('overall')) })
      .then(() => { toast('شكرًا! وصلت مراجعتك إلى زميلك دون اسمك.', 'good'); window.scrollTo(0, 0); loadPeer(); })
      .catch((err) => { peerState.error = err.message; render(); });
    return;
  }
  if (form.dataset.form === 'live-create') {
    const f = new FormData(form);
    const roles = {};
    for (const [k, v] of f.entries()) if (k.startsWith('role:') && String(v).trim()) roles[k.slice(5)] = String(v).trim();
    account.liveCreate({ eventId: f.get('eventId'), presenterEmail: f.get('presenterEmail'), scheduledAt: f.get('scheduledAt'), roles })
      .then((d) => { toast('أُنشئت الجلسة. يراها المقدّم ولاعبو الأدوار في صفحة الجلسات الحية.', 'good'); location.hash = `#/live/${d.session.id}`; })
      .catch((err) => { liveState.error = err.message; render(); });
    return;
  }
  if (form.dataset.form === 'live-say') {
    const f = new FormData(form);
    const text = String(f.get('text') || '').trim();
    if (!text) return;
    account.liveSay(form.dataset.id, { text, as: f.get('as') || undefined })
      .then((s) => { delete drafts[`live:${form.dataset.id}`]; saveDrafts(); liveState.room = s; render(); app.querySelector('#live-msg')?.focus(); })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'live-close') {
    const f = new FormData(form);
    const ratings = {};
    for (const [k, v] of f.entries()) {
      if (!k.startsWith('rating:') || !v) continue;
      ratings[k.slice(7)] = Number(v);
    }
    account.liveClose(form.dataset.id, { addressed: f.getAll('addressed'), optionId: f.get('optionId'), note: f.get('note'), ratings })
      .then((s) => { liveState.room = s; toast('انتهت الجلسة، ووصل الحكم إلى المقدّم.', 'good'); render(); })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'fac-review') {
    const f = new FormData(form);
    account.facReview({ userId: form.dataset.user, itemId: form.dataset.item, addressed: f.getAll('addressed'), optionId: f.get('optionId'), note: f.get('note') })
      .then(() => { toast('حُفظت المراجعة، وأُعيد حساب نقاط المتدرب.', 'good'); facState.selected = null; return loadFacilitator(); })
      .catch((err) => { facState.error = err.message; render(); });
    return;
  }
  if (form.dataset.form === 'forgot') {
    account.requestReset(String(new FormData(form).get('email') || ''))
      .then((r) => openModal(V.forgotModal(r.message)))
      .catch((err) => openModal(V.forgotModal('', err.message)));
    return;
  }
  if (form.dataset.form === 'reset') {
    const f = new FormData(form);
    if (f.get('password') !== f.get('password2')) { resetState = { error: 'كلمتا المرور غير متطابقتين.' }; render(); return; }
    account.resetPassword(parseRoute().itemId, String(f.get('password')))
      .then(async (u) => {
        user = u;
        Session.clear(); session = null; // حساب جديد على هذا الجهاز: يُحمّل التقدم من الخادم
        const remote = await account.progress().catch(() => null);
        if (remote) session = attach(Session.fromSave(world, remote));
        refreshAgents();
        resetState = { done: true }; render();
      })
      .catch((err) => { resetState = { error: err.message }; render(); });
    return;
  }
  if (form.dataset.form === 'auth') {
    submitAuth(form).catch((err) => openModal(V.authModal(form.dataset.mode, err.message)));
    return;
  }
  if (form.dataset.form === 'profile') {
    const f = new FormData(form);
    account.update({ name: f.get('name'), profile: { university: f.get('university'), major: f.get('major'), graduationYear: f.get('graduationYear'), city: f.get('city') } })
      .then((u) => { user = u; if (session) session.user = u; toast('حُفظ ملفك.', 'good'); render(); })
      .catch((err) => toast(err.message, 'bad'));
    return;
  }
  if (form.dataset.form === 'colleague') {
    const personId = form.dataset.person;
    const message = String(new FormData(form).get('message') || '').trim();
    if (!message) return;
    sendToColleague(personId, message).catch((err) => { console.error(err); toast(err.message, 'bad'); ui.pendingColleague = null; render(); });
    return;
  }
  if (form.dataset.form === 'meeting') {
    const message = String(new FormData(form).get('message') || '').trim();
    if (message.split(/\s+/).filter(Boolean).length < 3) { toast('اكتب ردًا أوضح للحاضرين.', 'bad'); return; }
    meetingStep(itemId, message).catch((err) => { console.error(err); toast(err.message, 'bad'); render(); });
    return;
  }
  try {
    if (form.dataset.form === 'respond') {
      const data = new FormData(form);
      const option = data.get('option');
      if (!option) { toast('اختر قرارًا أولًا.', 'bad'); return; }
      const result = session.respond(itemId, option, String(data.get('rationale') || '').trim());
      delete drafts[itemId]; saveDrafts();
      const it = session.sim.items.find((i) => i.id === itemId);
      ui.officeScene = it.type === 'meeting' ? { kind: 'meeting', people: [it.from, 'mentor', 'ux', 'eng_lead'] } : { kind: 'reply', from: it.from };
      quizSoon();
      toast(result.result || 'تم اعتماد القرار. ستظهر آثاره في نتائج الشركة.', result.tone === 'bad' ? 'bad' : 'good');
      location.hash = `#/inbox/${encodeURIComponent(itemId)}`;
      render();
    } else if (form.dataset.form === 'deliver') {
      const text = String(new FormData(form).get('text') || '').trim();
      if (words(text) < 15) { toast('المستند قصير جدًا للتسليم.', 'bad'); return; }
      const ev = session.deliver(itemId, text);
      delete drafts[itemId]; saveDrafts();
      ui.officeScene = { kind: 'deliver' };
      quizSoon();
      toast(`تم تسليم العمل — الدرجة ${Math.round(ev.score * 100)}%`, ev.score >= 0.6 ? 'good' : 'bad');
      location.hash = `#/inbox/${encodeURIComponent(itemId)}`;
      render();
    }
  } catch (err) {
    console.error(err);
    toast(err.message, 'bad');
    render();
  }
}
app.addEventListener('submit', (e) => guard(() => onSubmit(e)));
modalRoot.addEventListener('submit', onSubmit);

async function loadVerify() {
  const route = parseRoute();
  if (route.page !== 'verify') return;
  verifyState = { loading: true };
  render();
  try { verifyState = { record: await account.record(route.itemId) }; } catch (err) { verifyState = { error: err.message }; }
  render();
}

// إغلاق الصفحة أو إخفاؤها (الجوال): يُرسل الحفظ المؤجل فورًا
window.addEventListener('pagehide', () => saver.flush({ keepalive: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saver.flush({ keepalive: true }); });

async function loadConfirm() {
  confirmState = { loading: true };
  render();
  try {
    const r = await account.confirmEmail(parseRoute().itemId);
    if (user && r.user && user.id === r.user.id) { user = r.user; if (session) session.user = user; }
    confirmState = { ok: true };
  } catch (err) { confirmState = { error: err.message }; }
  render();
}

window.addEventListener('hashchange', () => {
  closeModal(); // الانتقال لصفحة أخرى يغلق أي نافذة مفتوحة
  if (parseRoute().page === 'facilitator') { loadFacilitator(); return; }
  if (parseRoute().page === 'live') { loadLive(); return; }
  if (parseRoute().page === 'peer') { loadPeer(); return; }
  if (parseRoute().page === 'report') { loadCollab(); loadChallengesForReport(); loadRealWork(); }
  if (['plan', 'desk'].includes(parseRoute().page)) loadPlanExtra();
  if (parseRoute().page === 'challenge') { loadChallenge(); return; }
  if (parseRoute().page === 'portfolio') { loadPortfolio(); return; }
  if (parseRoute().page === 'video') { loadVideo(); return; }
  if (parseRoute().page === 'pair') { loadPair(); return; }
  if (parseRoute().page === 'work') { loadWork(); return; }
  if (parseRoute().page === 'assess-report') { loadAssessReport(); return; }
  if (parseRoute().page === 'assessments') { loadAssessAdmin(); return; }
  if (parseRoute().page === 'assess' && parseRoute().itemId && assess?.token !== parseRoute().itemId) { enterAssess(parseRoute().itemId); return; }
  if (['leagues', 'league'].includes(parseRoute().page)) { loadLeagues(); return; }
  if (parseRoute().page === 'team' && !parseRoute().itemId) loadPairs();
  stopPreview?.(); stopPreview = null;
  if (parseRoute().page === 'inbox' && user) loadLiveResults().then(render);
  if (parseRoute().page === 'verify') { loadVerify(); return; }
  if (parseRoute().page === 'confirm-email') { loadConfirm(); return; }
  if (parseRoute().page === 'reset-password') resetState = {};
  render();
});

// ——— الإقلاع ———
(async function boot() {
  try {
    world = await loadWorld();
    // مرشح في جلسة تقييم: من الرابط، أو من جلسة هذا التبويب بعد إعادة التحميل
    if (parseRoute().page === 'assess-report') { await loadAssessReport(); return; }
    let at = parseRoute().page === 'assess' ? parseRoute().itemId : null;
    try { at ??= parseRoute().page !== 'assessments' && !location.hash.startsWith('#/verify') ? sessionStorage.getItem(ASSESS_KEY) : null; } catch { /* */ }
    if (at) { await enterAssess(at); return; }
    refreshAgents();
    if (parseRoute().page === 'verify') { await loadVerify(); return; }
    user = await account.me();
    if (parseRoute().page === 'challenge') loadChallenge();
    if (parseRoute().page === 'portfolio' && parseRoute().itemId) loadPortfolio();
    if (parseRoute().page === 'confirm-email') { await loadConfirm(); }
    if (parseRoute().page === 'facilitator') loadFacilitator();
    if (parseRoute().page === 'live') loadLive();
    if (parseRoute().page === 'peer') loadPeer();
    await loadLiveResults();
    if (user) {
      const remote = await account.progress().catch(() => null);
      const local = Session.localSave();
      // تُعتمد النسخة الأكثر تقدمًا: قد تكون نسخة المتصفح أحدث إذا أُغلقت الصفحة قبل اكتمال الرفع
      const localIsAhead = local && (!remote || (local.seed === remote.seed && (local.log?.length ?? 0) > (remote.log?.length ?? 0)));
      if (localIsAhead) { session = attach(Session.resume(world)); await account.saveProgress(session.saveData()).catch(() => {}); }
      else if (remote) session = attach(Session.fromSave(world, remote));
    } else if (Session.hasSave() && location.hash) {
      session = attach(Session.resume(world));
    }
    render();
    if (parseRoute().page === 'report') { loadCollab(); loadChallengesForReport(); loadRealWork(); }
    if (parseRoute().page === 'portfolio' && !parseRoute().itemId) loadPortfolio();
    if (parseRoute().page === 'video') loadVideo();
    if (parseRoute().page === 'pair') loadPair();
    if (parseRoute().page === 'work') loadWork();
    if (['plan', 'desk'].includes(parseRoute().page)) loadPlanExtra();
    if (parseRoute().page === 'assessments') loadAssessAdmin();
    if (['leagues', 'league'].includes(parseRoute().page)) loadLeagues();
    if (parseRoute().page === 'team' && !parseRoute().itemId) loadPairs();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="boot"><div><b>تعذر فتح نظام الشركة</b><p class="muted">${esc(err.message)}</p><p class="muted small">شغّل الواجهة عبر خادم محلي: <code>npm start</code></p></div></div>`;
  }
}());

// للاختبار الآلي وأدوات المطور
window.__mohaki = { get session() { return session; }, nextOpenItemHref, meetings };
