// المتحكم: يربط الشاشات بالجلسة، ويدير التنقل والأحداث والمسودات والنوافذ.
import { Session, loadWorld } from './lib/session.js';
import { esc, words } from './lib/ui.js';
import * as V from './views.js';
import { agentStatus, openMeeting, runTurn } from './lib/meeting-client.js';
import { colleagueReply } from './lib/colleague-client.js';
import { meetingResult, mustClose } from '../src/agents/meeting.js';

const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

let world = null;
let session = null;
const DRAFT_KEY = 'mohaki.drafts.v1';
let drafts = {};
try { drafts = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}'); } catch { drafts = {}; }
const saveDrafts = () => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(drafts)); } catch { /* */ } };

// الاجتماعات الجارية (تبقى عند التنقل أو إعادة التحميل حتى تُختتم)
const MEETING_KEY = 'mohaki.meetings.v1';
let meetings = {};
try { meetings = JSON.parse(sessionStorage.getItem(MEETING_KEY) || '{}'); } catch { meetings = {}; }
const saveMeetings = () => { try { sessionStorage.setItem(MEETING_KEY, JSON.stringify(meetings)); } catch { /* */ } };
const ui = { meetings, pendingMeeting: null, agentMode: 'offline', meetingNote: '', drafts };

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const [page = 'desk', id] = path.split('/');
  const params = new URLSearchParams(query);
  return { page: V.NAV.some((n) => n.id === page) ? page : 'desk', itemId: id ? decodeURIComponent(id) : null, filter: params.get('f') || 'open' };
}

function render() {
  if (!session) {
    app.innerHTML = V.welcome(world, Session.hasSave());
    document.title = 'محاكي — ابدأ يومك الوظيفي';
    return;
  }
  const route = parseRoute();
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
  modalRoot.querySelector('.modal button, .modal a')?.focus();
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
    drafts = {}; saveDrafts();
    for (const k of Object.keys(meetings)) delete meetings[k];
    saveMeetings();
    session = Session.start(world);
    location.hash = '#/desk';
    render();
  },
  resume() {
    session = Session.resume(world);
    if (!location.hash) location.hash = '#/desk';
    render();
  },
  reset() { openModal(V.resetConfirm()); },
  'confirm-reset'() { closeModal(); session = null; actions.start(); },
  'end-day'() { openModal(V.endDayConfirm(session)); },
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

app.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const itemId = form.dataset.item;
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
});

window.addEventListener('hashchange', () => { if (session) render(); });

// ——— الإقلاع ———
(async function boot() {
  try {
    world = await loadWorld();
    agentStatus().then((st) => { ui.agentMode = st.mode; if (session) render(); });
    if (Session.hasSave() && location.hash) session = Session.resume(world);
    render();
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="boot"><div><b>تعذر فتح نظام الشركة</b><p class="muted">${esc(err.message)}</p><p class="muted small">شغّل الواجهة عبر خادم محلي: <code>npm start</code></p></div></div>`;
  }
}());

// للاختبار الآلي وأدوات المطور
window.__mohaki = { get session() { return session; }, nextOpenItemHref, meetings };
