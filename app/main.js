// المتحكم: يربط الشاشات بالجلسة، ويدير التنقل والأحداث والمسودات والنوافذ.
import { Session, loadWorld } from './lib/session.js';
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
let confirmState = { loading: true };
let resetState = {};
let facState = { filter: 'pending', list: [], selected: null, calibration: null, loading: true, error: '' };
let liveState = { loading: true, sessions: [], meetings: [], createEvent: null, error: '', room: null };
let livePoll = null;

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
    const [list, calibration] = await Promise.all([account.facDialogues(facState.filter), account.facCalibration()]);
    facState = { ...facState, list, calibration, loading: false };
  } catch (err) { facState = { ...facState, loading: false, error: err.message }; }
  render();
}

/** يربط الجلسة بالحساب: كل حفظ محلي يُرفع إلى الخادم (مؤجلًا). */
function attach(s) {
  if (!s) return s;
  s.user = user;
  s.onSave = user ? (data) => saver.save(data) : null;
  return s;
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
  const extra = ['account', 'verify', 'confirm-email', 'reset-password', 'facilitator', 'live'];
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
  if (route.page === 'confirm-email') { app.innerHTML = V.confirmEmailPage(confirmState); document.title = 'تأكيد البريد — محاكي'; return; }
  if (route.page === 'reset-password') { app.innerHTML = V.resetPasswordPage(resetState); document.title = 'كلمة مرور جديدة — محاكي'; return; }
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
    case 'inbox': body = V.inbox(session, route, drafts, { ...ui, meetings, drafts }); break;
    case 'team': body = route.itemId
      ? V.colleagueChat(session, session.person(route.itemId), { ...ui, drafts })
      : V.team(session); break;
    case 'meetings': body = V.meetings(session); break;
    case 'files': body = V.files(session); break;
    case 'company': body = V.company(session); break;
    case 'feed': body = V.feed(session); break;
    case 'report': body = V.report(session); break;
    case 'account': body = V.accountPage(session, user); break;
    case 'live': body = !user ? '<section class="card"><div class="empty"><b>سجّل الدخول للانضمام إلى الجلسات الحية</b></div></section>'
      : route.itemId && liveState.room ? V.liveRoom(world, liveState.room, { drafts }) : V.livePage(user, liveState); break;
    case 'facilitator': body = user?.role === 'facilitator' ? V.facilitatorPage(world, facState) : '<section class="card"><div class="empty"><b>هذه الصفحة للمُيسِّرين فقط</b></div></section>'; break;
    default: body = V.desk(session);
  }
  const keepScroll = route.page === 'inbox' ? window.scrollY : 0;
  app.innerHTML = V.shell(session, route, body);
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
    if (!user && session.sim.day >= 2) { openModal(V.guestWall()); return; }
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
  if (el && actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](e); }
});
modalRoot.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && actions[el.dataset.act]) actions[el.dataset.act](e);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalRoot.innerHTML) closeModal(); });

app.addEventListener('change', (e) => {
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
      consents: { processing: f.get('processing') === 'on', employerSharing: f.get('employerSharing') === 'on' },
    })
    : await account.login(f.get('email'), f.get('password'));
  closeModal();
  // الدخول لحساب له تقدم سابق: يُعتمد تقدم الحساب. وإلا يُرفع تقدم الضيف الحالي إلى الحساب.
  const remote = register ? null : await account.progress().catch(() => null);
  if (remote) session = attach(Session.fromSave(world, remote));
  else if (session) { attach(session); await account.saveProgress(session.saveData()); }
  refreshAgents();
  await loadLiveResults();
  if (parseRoute().page === 'live') loadLive();
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
      toast(result.result || 'تم اعتماد القرار. ستظهر آثاره في نتائج الشركة.', result.tone === 'bad' ? 'bad' : 'good');
      location.hash = `#/inbox/${encodeURIComponent(itemId)}`;
      render();
    } else if (form.dataset.form === 'deliver') {
      const text = String(new FormData(form).get('text') || '').trim();
      if (words(text) < 15) { toast('المستند قصير جدًا للتسليم.', 'bad'); return; }
      const ev = session.deliver(itemId, text);
      delete drafts[itemId]; saveDrafts();
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
app.addEventListener('submit', onSubmit);
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
    refreshAgents();
    if (parseRoute().page === 'verify') { await loadVerify(); return; }
    user = await account.me();
    if (parseRoute().page === 'confirm-email') { await loadConfirm(); }
    if (parseRoute().page === 'facilitator') loadFacilitator();
    if (parseRoute().page === 'live') loadLive();
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
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="boot"><div><b>تعذر فتح نظام الشركة</b><p class="muted">${esc(err.message)}</p><p class="muted small">شغّل الواجهة عبر خادم محلي: <code>npm start</code></p></div></div>`;
  }
}());

// للاختبار الآلي وأدوات المطور
window.__mohaki = { get session() { return session; }, nextOpenItemHref, meetings };
