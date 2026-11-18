// شاشات بيئة العمل. كل دالة تعيد HTML من حالة المحرك الحالية.
import { roleOccupation } from '../src/occupations.js';
import { canMessage, DAILY_LIMIT } from '../src/agents/colleague.js';
import { computePoints, RECOMMENDATION_RULES } from '../src/points.js';
import {
  esc, fmt, sar, delta, words, PRIORITY, TYPE, STATUS, dueLabel, avatar, icon, typeIcon,
  lineChart, ring, bar, weekday, weekOf,
} from './lib/ui.js';
import { generatedMail, mailBody } from './lib/mail.js';
import { buildPlan, GOAL_ROLES, GOAL_NEEDS } from '../src/plan.js';
import { appraise, packOf } from '../src/rolepack.js';

const PRIORITY_RANK = { critical: 3, high: 2, normal: 1, low: 0 };

// ——— الهيكل العام ———

export const NAV = [
  { id: 'desk', label: 'مكتبي', sub: 'ملخص يوم العمل', icon: 'desk' },
  { id: 'job', label: 'ملفي الوظيفي', sub: 'الوصف والأهداف والصلاحيات والتقييم', icon: 'briefcase' },
  { id: 'plan', label: 'خطتي', sub: 'هدفك وجاهزيتك لسوق العمل', icon: 'growth' },
  { id: 'inbox', label: 'البريد', sub: 'المهام والرسائل والتقارير', icon: 'mail' },
  { id: 'team', label: 'فريقي', sub: 'الزملاء والمديرون', icon: 'team' },
  { id: 'meetings', label: 'الاجتماعات', sub: 'المواعيد والمناقشات', icon: 'meeting' },
  { id: 'files', label: 'ملفات الشركة', sub: 'بيانات وتقارير ومستندات', icon: 'files' },
  { id: 'library', label: 'المكتبة', sub: 'أدلة وسياسات ودراسات', icon: 'book' },
  { id: 'company', label: 'نتائج الشركة', sub: 'الأداء والنمو والمؤشرات', icon: 'chart' },
  { id: 'work', label: 'أعمال واقعية', sub: 'فرص حقيقية تُفتح بتقدمك', icon: 'task' },
  { id: 'feed', label: 'سجل الشركة', sub: 'ما الذي حدث ولماذا', icon: 'feed' },
  { id: 'report', label: 'تطورك المهني', sub: 'متابعة مستمرة', icon: 'growth' },
];

export function shell(session, route, content) {
  const sim = session.sim;
  const open = sim.inbox();
  const meetingsOpen = open.filter((i) => i.type === 'meeting').length;
  const badges = { inbox: open.length, meetings: meetingsOpen };
  const day = Math.min(sim.day, sim.lastDay);
  const finished = sim.finished;
  const dueToday = open.filter((i) => i.dueDay <= sim.day).length;
  return `
  <div class="shell">
    <aside class="side" aria-label="القائمة الرئيسية">
      <div class="co">
        <div class="co-logo">NT</div>
        <div><div class="co-name">NOVA TECH</div><div class="co-status">Online</div></div>
      </div>
      <nav class="nav">
        ${NAV.filter((n) => !session.assess || !['work', 'report', 'plan', 'job'].includes(n.id)).map((n) => `<a href="#/${n.id}" class="${route.page === n.id ? 'on' : ''}" ${route.page === n.id ? 'aria-current="page"' : ''}>
          ${icon(n.icon)}<span class="lbl">${n.label}<small>${n.sub}</small></span>
          ${badges[n.id] ? `<span class="badge">${badges[n.id]}</span>` : ''}
        </a>`).join('')}
      </nav>
      ${route.page !== 'desk' ? '<div class="office-mini-wrap" aria-label="المكتب"><div id="office-mini" class="office mini"></div><a href="#/desk" class="office-mini-open">المكتب ↗</a></div>' : ''}
      <div class="side-foot">
        <div class="me">${esc(session.assess?.name ?? session.user?.name ?? 'ضيف')}</div>
        <div>${esc(session.assess ? `جلسة تقييم · ${session.assess.company}` : sim.scenario.role)}</div>
        ${session.assess ? '<div class="small">يُحفظ تقدمك تلقائيًا. تُسلَّم الجلسة عند إنهاء اليوم الأخير.</div>' : session.user
          ? `<a href="#/account" class="side-link">حسابي</a> · <a href="#/profile" class="side-link">صفحتي</a> · <a href="#/org" class="side-link">دفعتي والجهة</a> · <a href="#/live" class="side-link">الجلسات الحية</a> · <a href="#/peer" class="side-link">مراجعة الأقران</a> · <a href="#/leagues" class="side-link">الدوري</a>${session.user.role === 'facilitator' ? ' · <a href="#/facilitator" class="side-link">لوحة المُيسِّر</a> · <a href="#/assessments" class="side-link">تقييمات الشركات</a>' : ''} · <button type="button" data-act="logout">خروج</button>`
          : `<button type="button" class="side-cta" data-act="open-auth" data-mode="register">أنشئ حسابًا لحفظ تقدمك</button>`}
        <div><button type="button" data-act="tour">جولة في المنصة</button>${session.assess ? '' : ' · <button type="button" data-act="reset">ابدأ من جديد</button>'}</div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="day">
          <b>${finished ? 'انتهت فترة العمل' : `يوم العمل ${day}`}</b>
          <span>${finished ? 'افتح سجلك المهني' : `${weekday(day)} · الأسبوع ${weekOf(day)} من ${Math.ceil(sim.lastDay / 5)} · ${dueToday ? `${dueToday} بند تنتهي مهلته اليوم` : 'لا مهلات تنتهي اليوم'}`}</span>
        </div>
        ${sim.rotationNow() ? `<span class="pill ${sim.rotationNow().home ? 't-pill' : 'p-high'} rot-chip" title="برنامج التدوير بين الإدارات">${sim.rotationNow().home ? 'إدارتك' : 'تدوير'}: ${esc(sim.rotationNow().label)}</span>` : ''}
        <div class="daybar" aria-hidden="true"><i style="width:${((day - (finished ? 0 : 1)) / sim.lastDay) * 100}%"></i></div>
        ${finished ? '' : `<div class="hours" title="ساعات يوم العمل: كل مهمة تستهلك وقتًا"><b class="num">${fmtH(sim.hoursLeft)}</b><span>من 8 ساعات باقية</span></div>`}
        <div class="spacer"></div>
        ${finished
          ? '<a class="btn teal" href="#/report">السجل المهني</a>'
          : `<button class="btn primary" type="button" data-act="end-day">${icon('clock').replace('<svg', '<svg width="16" height="16"')}<span>إنهاء يوم العمل</span></button>`}
      </header>
      <main class="content" id="content">${session.user && !session.user.emailVerified ? `<div class="verify-banner">
        <span>أرسلنا رابط تأكيد إلى <b dir="ltr">${esc(session.user.email)}</b>. أكّد بريدك لتتمكن من إصدار سجلك الموثّق ومشاركته مع جهات التوظيف.</span>
        <button class="btn sm" data-act="resend-verification">إعادة الإرسال</button></div>` : ''}${content}</main>
    </div>
  </div>`;
}

// ——— شاشة البداية ———

export function welcome(world, hasSave, user = null) {
  const sc = world.scenario;
  const co = world.company;
  const mgr = co.people.find((p) => p.id === sc.manager);
  const team = sc.team.map((id) => co.people.find((p) => p.id === id)?.title).filter(Boolean);
  return `
  <div class="welcome">
    <section class="l">
      <div class="brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>
      <div>
        <h1>خبرتك المهنية تبدأ قبل وظيفتك.</h1>
        <p>لا محاضرات ولا تمارين تنتظر التصحيح. ستدخل شركة تعمل الآن، فيها مدير وفريق وعملاء وميزانية، وقراراتك اليوم تغيّر ما يحدث غدًا.</p>
      </div>
      <p class="small" style="color:#8fa2c9">لا تنتظر الخبرة. اصنعها.</p>
    </section>
    <section class="r">
      <div>
        <div class="muted small">عرض وظيفي</div>
        <h2 style="margin:4px 0 0;font-size:24px">تم تعيينك في NOVA TECH</h2>
      </div>
      <div class="offer">
        <div class="row">
          <div class="co-logo" style="width:48px;height:48px">NT</div>
          <div><b style="font-size:17px">${esc(co.name)}</b><div class="muted small">${esc(co.tagline)} · ${esc(co.city)} · ${co.headcount} موظفًا</div></div>
        </div>
        <dl>
          <dt>الوظيفة</dt><dd>${esc(sc.role)}</dd>
          ${occupationRow(world.occupations, sc.roleId)}
          <dt>المدير المباشر</dt><dd>${esc(mgr?.name)} — ${esc(mgr?.title)}</dd>
          <dt>فريقك</dt><dd>${esc(team.join('، '))}</dd>
          <dt>المدة</dt><dd>${sc.lengthDays} يوم عمل (${Math.ceil(sc.lengthDays / 5)} أسابيع، من الأحد إلى الخميس) · كل يوم جلسة عمل واحدة</dd>
        </dl>
      </div>
      ${user ? `<p class="small" style="margin:0">مرحبًا ${esc(user.name)}. تقدمك محفوظ في حسابك.</p>` : ''}
      <div class="actions">
        ${hasSave ? '<button class="btn primary" data-act="resume">أكمل يوم عملك</button><button class="btn" data-act="start">ابدأ من جديد</button>'
          : user ? '<button class="btn primary" data-act="start">ابدأ يومك الوظيفي</button>'
          : '<button class="btn primary" data-act="open-auth" data-mode="register">أنشئ حسابًا وابدأ</button><button class="btn" data-act="open-auth" data-mode="login">لدي حساب</button><button class="btn ghost" data-act="start">جرّب يومك الأول كضيف</button>'}
      </div>
      ${user ? '' : '<p class="small muted" style="margin:0">الحساب يحفظ تقدمك على أي جهاز، وهو شرط لإصدار سجل الأداء الموثّق في النهاية.</p>'}
      <p class="disclaimer">NOVA TECH شركة افتراضية، وكل شخصياتها وعملائها خيالية. محاكي تمنحك أدلة عملية على مهاراتك، ولا تعادل خبرة وظيفية لدى شركة حقيقية.</p>
    </section>
  </div>`;
}

// ——— مكتبي ———

export function desk(session) {
  const sim = session.sim;
  const h = sim.history;
  const now = h[h.length - 1];
  const prev = h[Math.max(0, h.length - 2)];
  const open = sim.inbox();
  const dueToday = open.filter((i) => i.dueDay <= sim.day);
  const critical = open.filter((i) => i.priority === 'critical');
  const yesterday = sim.feed.filter((f) => f.day === sim.day - 1);
  const dash = sim.dashboard();
  const mgr = session.person(sim.scenario.manager);
  const trustMgr = Math.round(sim.state.player.trust[mgr.id] ?? 50);
  const first = sim.day === 1 && !session.log.length;

  return `
  <section class="card hero">
    <h2>${first ? 'أهلًا بك في يومك الأول' : sim.finished ? 'انتهت فترة عملك الأولى في NOVA TECH' : `صباح الخير — ${weekday(sim.day)}، يوم العمل ${sim.day}`}</h2>
    <p>${first && session.assess ? 'ثلاثة أيام عمل مكثفة. ابدأ بالموجز من مديرك (5 دقائق قراءة)، ثم بريدك. كل بند مهلته اليوم: رتّب أولوياتك، واسأل زملاءك عن الأرقام قبل أن تقرر.' : first
      ? 'يومك الأول للتعرّف: رسالة ترحيب من مديرك، واجتماع تعارف مع الفريق، ودليل الموظف تقرؤه في المكتبة، ثم تسألك مشرفتك سلمى عمّا فهمت. المهام الحقيقية تبدأ غدًا.'
      : sim.finished ? 'راجع ما حققته بقراراتك في سجلك المهني.' : 'هذا ما ينتظرك اليوم. البنود التي تنتهي مهلتها اليوم ستُغلق عند نهاية يوم العمل، ولتجاهلها عواقب.'}</p>
    <div class="stats">
      <div><b class="num">${open.length}</b><span>بنود مفتوحة</span></div>
      <div><b class="num">${dueToday.length}</b><span>تنتهي اليوم</span></div>
      <div><b class="num">${critical.length}</b><span>حرجة</span></div>
      <div><b class="num">${trustMgr}</b><span>ثقة مديرك بك</span></div>
    </div>
    ${open.length ? `<div class="actions" style="position:relative;z-index:1"><a class="btn teal" href="#/inbox/${encodeURIComponent(open[0].id)}">ابدأ بالأهم: ${esc(open[0].title)}</a></div>` : ''}
  </section>

  ${session.assess ? '' : planStrip(session)}
  ${!first && !open.length && !sim.finished ? whatNow(session) : ''}

  <section class="card office-card" style="margin-top:16px">
    <div class="office-h"><h2>المكتب الآن</h2><span class="small muted">زملاؤك أثناء عملهم. اضغط على أي زميل لمراسلته.</span></div>
    <div id="office" class="office"></div>
  </section>

  ${first ? `<section class="card guide" style="margin-top:16px">
    <h2>كيف تعمل محاكي</h2>
    <ol>
      <li><b>بريد العمل</b> تصلك فيه المهام والرسائل والتقارير اليومية. افتح الرسالة، واقرأ، ثم رد أو سلّم ما طُلب.</li>
      <li><b>المكتبة</b> فيها دليل الموظف والسياسات والدراسات. اقرأ حين تنهي مهامك: بعضها فيه ملاحظات مهمة لا يقولها أحد.</li>
      <li><b>لكل بند مهلة.</b> ما تتركه حتى تنتهي مهلته يُغلق، وله عواقب على الشركة وثقة زملائك.</li>
      <li><b>"إنهاء يوم العمل"</b> يجعل الشركة تعمل بقية اليوم: تظهر نتائج قراراتك، ويبدأ يوم جديد. أسبوع العمل من الأحد إلى الخميس، ومدة التجربة 30 يوم عمل.</li>
      <li><b>اسأل زملاءك</b> من صفحة "فريقي" عن البيانات قبل أن تقرر.</li>
      <li>في النهاية تحصل على <b>نقاط من 1000</b> و<b>سجل أداء موثّق</b> يمكن التحقق منه، ويمكنك أن تختار مشاركته مع جهات توظيف شريكة.</li>
    </ol>
  </section>` : ''}

  <div class="grid g-4" style="margin-top:16px">
    ${kpi('الإيراد الشهري المتكرر', sar(now.mrr), delta(now.mrr, prev.mrr), 'منذ أمس')}
    ${kpi('العملاء', `<span class="num">${now.customers}</span>`, delta(now.customers, prev.customers), 'منذ أمس')}
    ${kpi('رضا العملاء', `<span class="num">${now.avgHealth}</span><small>/100</small>`, delta(now.avgHealth, prev.avgHealth), 'منذ أمس')}
    ${kpi('النقد المتاح', sar(now.cash), now.runwayMonths ? `<span class="delta flat">مدرج ${now.runwayMonths} شهرًا</span>` : '<span class="delta up">رابحة</span>', '')}
  </div>

  <div class="grid g-main" style="margin-top:16px">
    <section class="card">
      <h2>أولويات اليوم <a href="#/inbox">كل المهام ←</a></h2>
      ${open.length ? `<div class="items">${open.slice(0, 6).map((i) => itemRow(session, i)).join('')}</div>`
        : '<div class="empty"><b>صندوق العمل فارغ</b>أنهيت كل ما عليك. يمكنك مراجعة نتائج الشركة أو إنهاء يوم العمل.</div>'}
    </section>
    <div class="grid" style="align-content:start">
      <section class="card">
        <h2>${sim.day === 1 ? 'أخبار الشركة' : 'ما حدث أمس'} <a href="#/feed">السجل ←</a></h2>
        ${yesterday.length ? feedList(yesterday.slice(-6)) : `<p class="muted small" style="margin:0">${sim.day === 1 ? 'الشركة تعمل منذ ثلاث سنوات. أنت أحدث موظف فيها.' : 'يوم هادئ دون أحداث تُذكر.'}</p>`}
      </section>
      <section class="card">
        <h2>خارطة الطريق <a href="#/company">التفاصيل ←</a></h2>
        ${roadmapBlock(dash.roadmap, sim.state.company.roadmap)}
      </section>
    </div>
  </div>`;
}

function kpi(label, value, deltaHtml, note) {
  return `<section class="card kpi"><div class="k-l">${label}</div><div class="k-v">${value}</div>${deltaHtml} <span class="muted small">${note}</span></section>`;
}

function roadmapBlock(dash, raw) {
  if (!raw.active && !raw.queue.length && !raw.shipped.length) {
    return '<p class="muted small" style="margin:0">لم يُحدَّد بعد ما يعمل عليه فريق التطوير. قرارك في تخطيط السبرنت سيحدد ذلك.</p>';
  }
  const a = raw.active;
  return `
    ${a ? `<div class="barrow"><span><b>قيد التطوير:</b> ${esc(a.title)}</span><span class="num muted">${Math.min(100, Math.round((a.progress / a.effort) * 100))}%</span>${bar(a.progress, { max: a.effort, cls: 'navy' })}</div>` : '<p class="muted small">الفريق بلا بند نشط الآن.</p>'}
    ${raw.queue.length ? `<p class="small" style="margin:12px 0 0"><span class="muted">في الانتظار:</span> ${raw.queue.map((x) => esc(x.title)).join('، ')}</p>` : ''}
    ${raw.shipped.length ? `<p class="small" style="margin:6px 0 0"><span class="muted">تم إطلاقه:</span> ${raw.shipped.map((x) => `${esc(x.title)} <span class="muted">(يوم ${x.shippedDay})</span>`).join('، ')}</p>` : ''}`;
}

function mailRow(session, m, activeId, filterQ = '') {
  const from = session.person(m.from);
  const label = { report: 'تقرير', memo: 'تعميم', doc: 'المكتبة', job: 'الموارد البشرية' }[m.kind];
  return `<a class="item ${m.id === activeId ? 'on' : ''} ${session.opened?.[m.id] ? '' : 'unread'}" href="#/inbox/${encodeURIComponent(m.id)}${filterQ}">
    <span class="ico">${icon(m.kind === 'report' ? 'chart' : m.kind === 'doc' ? 'book' : 'mail')}</span>
    <span><div class="tt">${m.title.startsWith('FYI') ? '' : '<abbr class="tag fyi" title="For Your Information: للعلم فقط">FYI</abbr>'}${esc(m.title)}</div><div class="meta"><span>${esc(from.name)}</span><span class="pill t-pill">${label}</span></div></span>
    <span class="due">يوم ${m.day}</span></a>`;
}

function itemRow(session, item, activeId, filterQ = '') {
  const sim = session.sim;
  const from = session.person(item.from);
  const due = dueLabel(item, sim.day);
  return `<a class="item ${item.id === activeId ? 'on' : ''} ${item.status !== 'open' ? 'done' : ''} ${item.status !== 'open' || session.opened?.[item.id] ? '' : 'unread'}" href="#/inbox/${encodeURIComponent(item.id)}${filterQ}">
    <span class="ico">${typeIcon(item.type)}</span>
    <span>
      <div class="tt">${mailTags(item, sim)}${esc(item.title)}</div>
      <div class="meta"><span>${esc(from.name)}</span>
        ${item.status === 'open' ? `<span class="pill p-${item.priority}">${PRIORITY[item.priority]}</span>` : `<span class="pill s-${item.status}">${STATUS[item.status]}</span>`}
        <span class="pill t-pill">${item.research ? 'بحث' : item.deliverable ? 'مستند' : item.dialogue?.mode === 'chat' ? 'محادثة' : TYPE[item.type] ?? ''}</span>
      </div>
    </span>
    <span class="due ${item.status === 'open' && item.dueDay <= sim.day ? 'today' : ''}">${due || `يوم ${item.createdDay}`}</span>
  </a>`;
}

function feedList(entries) {
  return `<ul class="feed">${entries.map((f) => `<li class="${f.tone}"><span class="d">يوم ${f.day}</span><span class="dot"></span><span>${esc(f.text)}</span></li>`).join('')}</ul>`;
}

// ——— مهامي ———

export function inbox(session, { itemId, filter = 'open' }, drafts, ui = {}) {
  const sim = session.sim;
  const all = [...sim.items].reverse();
  const mails = generatedMail(session);
  // البريد كله: البنود والبريد المولَّد مرتبة بالأحدث
  const everything = [...all.map((i) => ({ t: 'item', day: i.createdDay, x: i })), ...mails.map((m) => ({ t: 'mail', day: m.day, x: m }))]
    .sort((a, b) => b.day - a.day);
  const lists = {
    open: sim.inbox().map((x) => ({ t: 'item', x })),
    all: everything,
    closed: all.filter((i) => i.status !== 'open').map((x) => ({ t: 'item', x })),
  };
  const list = lists[filter] ?? lists.open;
  const mailSel = itemId?.startsWith('mail:') ? mails.find((m) => m.id === itemId) : null;
  const selected = mailSel ? null : itemId ? sim.items.find((i) => i.id === itemId) : list[0]?.t === 'item' ? list[0].x : null;
  const activeId = mailSel?.id ?? selected?.id;
  const q = `?f=${filter}`;
  const unread = (l) => l.filter((e) => !session.opened?.[e.x.id]).length;
  const tab = (id, label) => `<a href="#/inbox${activeId ? `/${encodeURIComponent(activeId)}` : ''}?f=${id}" class="${filter === id ? 'on' : ''}">${label} <span class="num">${id === 'all' ? unread(lists[id]) || lists[id].length : lists[id].length}</span></a>`;
  const detail = mailSel ? mailDetail(session, mailSel) : selected ? itemDetail(session, selected, drafts, ui) : '<div class="empty"><b>اختر رسالة</b>لعرضها والتصرف فيها.</div>';
  return `
  <div class="page-h"><div><h1>بريد العمل</h1><p>تصلك هنا المهام والرسائل والتقارير. افتح الرسالة واقرأها، ثم رد أو سلّم ما طُلب.</p></div></div>
  <div class="inbox-layout ${itemId && (selected || mailSel) ? 'has-sel' : ''}">
    <section class="card inbox-list" aria-label="الرسائل">
      <div class="tabs">${tab('open', 'يتطلب إجراء')}${tab('all', 'البريد كله')}${tab('closed', 'منجزة')}</div>
      ${list.length ? `<div class="items">${list.map((e) => (e.t === 'mail' ? mailRow(session, e.x, activeId, q) : itemRow(session, e.x, activeId, q))).join('')}</div>`
        : `<div class="empty"><b>${filter === 'open' ? 'لا شيء يتطلب إجراء' : 'لا شيء هنا بعد'}</b>${filter === 'open' ? 'أنجزت ما عليك اليوم. انظر "ماذا الآن؟" في مكتبي.' : ''}</div>`}
    </section>
    <section class="card detail">${activeId ? `<a class="back-link" href="#/inbox${q}">→ العودة إلى القائمة</a>` : ''}${detail}</section>
  </div>`;
}

function mailDetail(session, m) {
  const from = session.person(m.from);
  return `<div class="from">${avatar(from)}<div><b>${esc(from.name)}</b><div class="muted small">${esc(from.title)}</div></div></div>
    <div class="chips"><span class="pill t-pill">${{ report: 'تقرير يومي', memo: 'تعميم', doc: 'المكتبة', job: 'الموارد البشرية' }[m.kind]}</span><span class="pill t-pill">يوم ${m.day}</span><span class="pill t-pill">للاطلاع</span></div>
    <h1>${jg(session, esc(m.title))}</h1>
    <div class="mail-body">${mailBody(session, m, (x) => jg(session, esc(x)))}</div>`;
}

export function itemDetail(session, item, drafts = {}, ui = {}) {
  const sim = session.sim;
  const from = session.person(item.from);
  const due = dueLabel(item, sim.day);
  const head = `
    <div class="from">${avatar(from)}<div><b>${esc(from.name)}</b><div class="muted small">${esc(from.title)}</div></div></div>
    <div class="chips">
      <span class="pill p-${item.priority}">أولوية ${PRIORITY[item.priority]}</span>
      <span class="pill t-pill">${item.research ? 'مهمة بحث' : item.deliverable ? 'مستند مطلوب' : TYPE[item.type] ?? ''}</span>
      ${item.status === 'open' ? `<span class="pill t-pill" title="ما يستهلكه هذا البند من ساعات اليوم">⏱ ${fmtH(sim.costOf(item))} س</span>` : ''}
      <span class="pill t-pill">وصل يوم ${item.createdDay}</span>
      ${item.status === 'open' ? `<span class="pill ${item.dueDay <= sim.day ? 'p-critical' : 't-pill'}">${due}</span>` : `<span class="pill s-${item.status}">${STATUS[item.status]}</span>`}
    </div>
    <h1>${jg(session, esc(item.title))}</h1>
    <p class="body">${jg(session, esc(item.body))}</p>
    ${attachmentsBlock(session, item)}`;

  if (item.research) return `${head}${researchView(session, item)}`;

  if (item.status === 'open' && item.deliverable) {
    const draft = drafts[item.id] ?? '';
    const min = item.deliverable.minWords ?? 80;
    return `${head}
    <form class="editor" data-form="deliver" data-item="${esc(item.id)}">
      <div class="field">
        <label for="doc">المستند</label>
        <textarea id="doc" name="text" data-draft="${esc(item.id)}" placeholder="اكتب مستندك هنا. خالد يقرأ الأدلة والأرقام والتوصية القابلة للقياس.">${esc(draft)}</textarea>
        <div class="hint"><span>الطول المتوقع: ${min} كلمة على الأقل</span><span class="num" data-wc>${words(draft)} كلمة</span></div>
      </div>
      <div class="actions">
        <button class="btn primary" type="submit">تسليم العمل</button>
        <span class="muted small">بعد التسليم لا يمكن التعديل. يُقيَّم المستند وفق معيار واضح، وتظهر النتيجة فورًا.</span>
      </div>
    </form>`;
  }

  if (item.status === 'open' && item.dialogue && ui.liveResults?.[item.eventId]) {
    const r = ui.liveResults[item.eventId];
    const opt = item.options.find((o) => o.id === r.optionId);
    return `${head}<div class="outcome good"><h3>عُقد هذا الاجتماع في جلسة حية</h3>
      <p>حكم المُيسِّر: <b>${esc(opt?.label ?? r.optionId)}</b> · ${r.addressed.length} من ${item.dialogue.concerns.length} اعتراضات مجابة.</p>
      ${r.note ? `<p class="small"><b>ملاحظة المُيسِّر:</b> ${esc(r.note)}</p>` : ''}
      <div class="actions"><button class="btn primary" data-act="apply-live" data-item="${esc(item.id)}">اعتماد نتيجة الجلسة الحية</button>
      <span class="small muted">تُطبَّق على الشركة كما حكم بها المُيسِّر، ولا يمكن تعديلها.</span></div></div>
      ${minutes(session, r.transcript.map((l) => ({ speaker: l.speaker, text: l.text })), { full: true })}`;
  }
  if (item.status === 'open' && item.dialogue) return `${head}${delegateBlock(session, item, drafts)}${meetingRoom(session, item, ui)}`;

  // رسالة قراءة: مرفق للاطلاع وتأكيد واحد
  if (item.status === 'open' && item.attachments?.length && item.options.length === 1) {
    // يكفي فتح المرفق الأساسي (الأول)، والبقية للاستزادة
    const unread = item.attachments.slice(0, 1).filter((a) => !session.read?.[a]);
    return `${head}<div class="actions">
      <button class="btn primary" data-act="ack-read" data-item="${esc(item.id)}" ${unread.length ? 'disabled' : ''}>${esc(item.options[0].label)}</button>
      ${unread.length ? '<span class="small muted">افتح المرفق واقرأه أولًا.</span>' : ''}</div>`;
  }

  if (item.status === 'open') {
    const d = drafts[item.id] ?? {};
    return `${head}
    <form data-form="respond" data-item="${esc(item.id)}">
      <fieldset class="options">
        <legend class="section-t">ما قرارك؟</legend>
        ${item.options.map((o) => `<label class="opt"><input type="radio" name="option" value="${esc(o.id)}" ${d.option === o.id ? 'checked' : ''} required><span>${esc(o.label)}</span></label>`).join('')}
      </fieldset>
      <div class="field">
        <label for="why">لماذا؟ <span class="muted small">(التبرير جزء من تقييمك)</span></label>
        <textarea id="why" name="rationale" rows="3" data-draft="${esc(item.id)}" data-draft-field="rationale" placeholder="ما الدليل الذي استندت إليه؟ ما المخاطر؟ كيف سيؤثر القرار على العميل والفريق؟">${esc(d.rationale ?? '')}</textarea>
      </div>
      <div class="actions"><button class="btn primary" type="submit">اعتماد القرار</button></div>
    </form>`;
  }

  return `${head}${closedOutcome(session, item)}`;
}

function closedOutcome(session, item) {
  const sim = session.sim;
  const act = sim.actions.find((a) => a.itemId === item.id);
  if (item.status === 'delegated' || act?.delegated) {
    const who = session.person(item.delegable?.to ?? 'junior');
    const back = item.status === 'delegated';
    return `<div class="outcome ${back ? 'info' : act.briefOk ? 'good' : 'bad'}"><h3>${back ? `مُسند إلى ${esc(who.name)}: يعود يوم ${item.resolution.returnDay}` : act.briefOk ? `${esc(who.name)} أنجز التكليف` : `عاد التكليف من ${esc(who.name)} ناقصًا`}</h3>
      <p class="small"><b>تكليفك:</b> «${esc(act.rationale)}»</p>
      ${!act.briefOk ? `<p class="small muted">التكليف الواضح يحدد الهدف، والمطلوب بالتحديد، والموعد. ${esc(item.delegable?.criteria ?? '')}</p>` : ''}</div>`;
  }
  if (item.status === 'expired') {
    return `<div class="outcome bad"><h3>فات الموعد دون تصرف</h3>
      ${item.onExpire?.result ? `<p>${esc(item.onExpire.result)}</p>` : '<p>أُغلق البند دون رد.</p>'}</div>`;
  }
  if (act?.kind === 'deliverable') {
    const ev = act.evaluation;
    const pass = ev.score >= (item.deliverable.passScore ?? 0.6);
    const branch = pass ? item.deliverable.onGood : item.deliverable.onWeak;
    return `<div class="outcome ${pass ? 'good' : 'bad'}">
      <h3>تم تسليم العمل يوم ${act.day} — الدرجة <span class="num">${Math.round(ev.score * 100)}%</span></h3>
      ${branch?.result ? `<p>${esc(branch.result)}</p>` : ''}
      <ul class="check">${ev.sections.map((s) => `<li class="${s.covered ? '' : 'miss'}">${esc(s.label)}</li>`).join('')}</ul>
      <p class="small muted">${ev.words} كلمة</p>
    </div>
    <details style="margin-top:12px"><summary class="small">عرض المستند المسلّم</summary><p style="white-space:pre-wrap" class="small">${esc(act.text)}</p></details>`;
  }
  const opt = item.options.find((o) => o.id === item.resolution?.optionId);
  if (act?.transcript) {
    const concerns = item.dialogue.concerns;
    return `<div class="outcome ${opt?.tone === 'bad' || act.addressed.length < Math.min(2, concerns.length) ? 'bad' : 'good'}">
      <h3>نتيجة ${item.dialogue.mode === 'chat' ? 'المحادثة' : 'الاجتماع'} يوم ${item.resolution?.day}: ${esc(opt?.label)}</h3>
      ${opt?.result ? `<p>${esc(opt.result)}</p>` : ''}
      <p class="small">حققت <b class="num">${act.addressed.length}</b> من <b class="num">${concerns.length}</b> ${item.dialogue.mode === 'chat' ? 'نقاط' : 'اعتراضات'}.</p>
      <ul class="check">${concerns.map((c) => `<li class="${act.addressed.includes(c.id) ? '' : 'miss'}">${esc(session.person(c.owner).name)}: ${esc(c.label)}</li>`).join('')}</ul>
      <p class="small muted">${modeLabel(act.mode)}</p>
      ${session.reviews?.[item.id]?.note ? `<p class="small"><b>ملاحظة المُيسِّر (${esc(session.reviews[item.id].byName ?? '')}):</b> ${esc(session.reviews[item.id].note)}</p>` : ''}
    </div>
    <h2 class="section-t" style="margin-top:18px">${item.dialogue.mode === 'chat' ? 'نص المحادثة' : 'محضر الاجتماع'}</h2>
    ${minutes(session, act.transcript, { full: true })}`;
  }
  return `<div class="outcome ${opt?.tone === 'bad' ? 'bad' : 'info'}">
    <h3>قرارك يوم ${item.resolution?.day}: ${esc(opt?.label)}</h3>
    ${opt?.result ? `<p>${esc(opt.result)}</p>` : '<p class="muted">سُجّل القرار. ستظهر آثاره في نتائج الشركة.</p>'}
    ${act?.rationale ? `<p class="small"><b>تبريرك:</b> ${esc(act.rationale)}</p>` : '<p class="small muted">لم تكتب تبريرًا.</p>'}
  </div>`;
}

// ——— فريقي ———

export function team(session, ui = {}) {
  const sim = session.sim;
  const people = session.world.company.people;
  // ريان (الزميل المنفّذ) ينضم يوم 6
  const directIds = [sim.scenario.manager, ...sim.scenario.team].filter((id) => id !== 'junior' || sim.day >= 6);
  const direct = directIds.map((id) => people.find((p) => p.id === id)).filter(Boolean);
  const others = people.filter((p) => !directIds.includes(p.id) && !p.external);
  const externals = people.filter((p) => p.external);
  const rot = sim.rotationNow();
  const net = sim.report().evidence.network;
  const card = (p) => {
    const t = sim.state.player.trust[p.id];
    const met = sim.connections[p.id] ?? [];
    const wait = met.length ? 5 - (sim.day - met.at(-1)) : 0;
    return `<section class="card person">${avatar(p)}<div style="flex:1;min-width:0">
      <div class="nm">${esc(p.name)}</div><div class="ti">${esc(p.title)}</div>
      <div class="pe">${esc(p.persona)}</div>
      ${t !== undefined ? `<div class="barrow"><span>ثقته بك</span><span class="num">${Math.round(t)}</span>${bar(t)}</div>`
        : '<div class="muted small">لم تتعامل معه مباشرة بعد.</div>'}
      <div class="tag-list" style="margin-top:10px">${(p.cares ?? []).map((c) => `<span class="pill t-pill">${esc(c)}</span>`).join('')}</div>
      ${canMessage(p) ? `<div class="actions" style="margin-top:12px"><a class="btn sm" href="#/team/${esc(p.id)}">راسل ${esc(firstName(p))}${session.thread(p.id).length ? ` <span class="muted num">(${session.thread(p.id).length})</span>` : ''}</a>
        <button class="btn sm ghost" data-act="connect" data-person="${esc(p.id)}" ${wait > 0 || sim.finished ? 'disabled' : ''} title="نصف ساعة من يومك">${wait > 0 ? `جلسة تعارف بعد ${wait} أيام` : met.length ? 'جلسة متابعة ☕' : 'جلسة تعارف ☕'}</button>${met.length ? `<span class="small muted">التقيتما ${met.length} ${met.length === 1 ? 'مرة' : 'مرات'}</span>` : ''}</div>`
        : p.external ? `<div class="actions" style="margin-top:12px"><button class="btn sm ghost" data-act="connect" data-person="${esc(p.id)}" ${wait > 0 || sim.finished ? 'disabled' : ''}>${wait > 0 ? `اتصال متابعة بعد ${wait} أيام` : 'اتصال اطمئنان ☕'}</button>${met.length ? `<span class="small muted">تواصلتما ${met.length} ${met.length === 1 ? 'مرة' : 'مرات'}</span>` : ''}</div>` : ''}
    </div></section>`;
  };
  return `
  <div class="page-h"><div><h1>فريقي</h1><p>كل شخص في الشركة له أولوياته. الثقة تُبنى بالقرارات وتُفقد بالتجاهل والوعود غير المنفذة. ويمكنك مراسلة أي زميل في أي وقت لتسأله عمّا يعرفه.</p></div></div>
  <section class="card network" style="margin-bottom:16px"><h2>شبكة علاقاتك</h2>
    <p class="small muted" style="margin-top:0">ابنِ العلاقة قبل أن تحتاجها: جلسة تعارف تأخذ نصف ساعة من يومك، وتعرّفك بما يهم الشخص. ${rot && !rot.home ? `<b>أنت هذا الأسبوع في ${esc(rot.label)}: تعرّف على اثنين من الفريق على الأقل.</b>` : ''}</p>
    <div class="pf-stats"><div><b class="num">${net.internal}</b><span>زملاء جلست معهم</span></div><div><b class="num">${net.departments}</b><span>إدارات تعرفت عليها</span></div><div><b class="num">${net.external}</b><span>عملاء تواصلت معهم</span></div><div><b class="num">${net.trusted}</b><span>يثقون بك (65+)</span></div></div></section>
  ${realPartnerCard(session, ui)}
  <h2 class="section-t">مديرك وفريقك المباشر</h2>
  <div class="grid g-2">${direct.map(card).join('')}</div>
  <h2 class="section-t" style="margin-top:24px">بقية الشركة</h2>
  <div class="grid g-2">${others.map(card).join('')}</div>
  <h2 class="section-t" style="margin-top:24px">خارج الشركة: العملاء</h2>
  <div class="grid g-2">${externals.map(card).join('')}</div>`;
}

// ——— الاجتماعات ———

export function meetings(session) {
  const sim = session.sim;
  const list = [...sim.items].filter((i) => i.type === 'meeting')
    .sort((a, b) => (a.status === 'open') === (b.status === 'open') ? b.createdDay - a.createdDay : a.status === 'open' ? -1 : 1);
  return `
  <div class="page-h"><div><h1>الاجتماعات</h1><p>اجتماعات اليوم والسابقة. في كل اجتماع اعتراضات ووجهات نظر، وعليك أن تقرر.</p></div></div>
  <section class="card">
    ${list.length ? `<div class="items">${list.map((i) => itemRow(session, i)).join('')}</div>`
      : '<div class="empty"><b>لا اجتماعات بعد</b></div>'}
  </section>`;
}

// ——— ملفات الشركة ———

export function files(session) {
  const co = session.world.company;
  const st = session.sim.state.company;
  const dash = session.sim.dashboard();
  return `
  <div class="page-h"><div><h1>ملفات الشركة</h1><p>بيانات وتقارير ومستندات. القرار الجيد يبدأ من هنا.</p></div></div>
  <div class="grid g-2">
    <section class="card">
      <h2>المنتج: ${esc(co.product.name)}</h2>
      <p style="margin:0 0 12px">${esc(co.product.description)}</p>
      <table><tbody>
        <tr><td class="muted">التسعير</td><td>${esc(co.product.pricing)} · <span class="num">${fmt(st.pricing.seatPrice)}</span> ر.س للمستخدم</td></tr>
        <tr><td class="muted">جودة المنتج</td><td><span class="num">${Math.round(st.productQuality)}</span>/100</td></tr>
        <tr><td class="muted">تذاكر الدعم المفتوحة</td><td class="num">${Math.round(st.supportBacklog)}</td></tr>
        <tr><td class="muted">المرحلة</td><td>${esc(co.stage)}</td></tr>
      </tbody></table>
    </section>
    <section class="card">
      <h2>تقرير استخدام الخصائص</h2>
      <div class="grid" style="gap:12px">
        ${Object.entries(st.features).map(([, f]) => `<div class="barrow"><span>${esc(f.name)} ${f.trend < 0 ? '<span class="delta down">▼ في تراجع</span>' : f.trend > 0.1 ? '<span class="delta up">▲ في تحسن</span>' : ''}</span><span class="num">${Math.round(f.usage)}%</span>${bar(f.usage)}</div>`).join('')}
      </div>
    </section>
  </div>
  <section class="card" style="margin-top:16px">
    <h2>الحسابات الاستراتيجية</h2>
    <div class="tbl-wrap"><table>
      <thead><tr><th>العميل</th><th>القطاع</th><th>الإيراد الشهري</th><th style="min-width:140px">الرضا</th><th>الحالة</th></tr></thead>
      <tbody>${st.accounts.map((a) => `<tr>
        <td><b>${esc(a.name)}</b></td><td>${esc(a.segment)}</td><td class="num">${fmt(a.mrr)}</td>
        <td><div class="barrow"><span></span><span class="num">${Math.round(a.health)}</span>${bar(a.health)}</div></td>
        <td>${a.status === 'active' ? (a.health < 30 ? '<span class="pill p-critical">معرّض للخسارة</span>' : '<span class="pill s-done">نشط</span>') : '<span class="pill s-expired">خسرناه</span>'}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <p class="muted small" style="margin:10px 0 0">إضافة إلى <span class="num">${st.tail.count}</span> منشأة صغيرة بمتوسط <span class="num">${fmt(st.tail.avgMrr)}</span> ر.س شهريًا.</p>
  </section>
  <div class="grid g-2" style="margin-top:16px">
    <section class="card">
      <h2>المنافسون</h2>
      <table><thead><tr><th>المنافس</th><th>السعر</th><th>التموضع</th></tr></thead>
      <tbody>${st.competitors.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td class="num">${c.seatPrice}</td><td class="small">${esc(c.positioning)}</td></tr>`).join('')}
      <tr><td><b>NOVA TECH</b></td><td class="num">${Math.round(st.pricing.seatPrice)}</td><td class="small">أنت هنا</td></tr></tbody></table>
    </section>
    <section class="card">
      <h2>الهيكل التنظيمي</h2>
      <table><tbody>${co.departments.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${d.headcount}</td></tr>`).join('')}</tbody></table>
    </section>
  </div>
  <p class="muted small" style="margin-top:16px">جودة المنتج الآن <span class="num">${dash.productQuality}</span>، والروح المعنوية للفريق <span class="num">${dash.morale}</span>.</p>`;
}

// ——— نتائج الشركة ———

export function company(session) {
  const sim = session.sim;
  const h = sim.history;
  const now = h[h.length - 1];
  const start = h[0];
  const dash = sim.dashboard();
  const series = (k) => h.map((x) => x[k]);
  const chart = (title, key, color, fmtFn = fmt, suffix = '') => `
    <section class="card chart"><div class="c-h"><span class="muted small">${title}</span><b class="num">${fmtFn(now[key])}${suffix}</b></div>
    ${lineChart(series(key), { color, format: fmtFn, label: title })}</section>`;
  return `
  <div class="page-h"><div><h1>نتائج الشركة</h1><p>كيف يرتبط عملك بالنتائج العامة. المقارنة هنا مع يوم انضمامك.</p></div></div>
  <div class="grid g-4">
    ${kpi('الإيراد الشهري المتكرر', sar(now.mrr), delta(now.mrr, start.mrr), 'منذ انضمامك')}
    ${kpi('العملاء', `<span class="num">${now.customers}</span>`, delta(now.customers, start.customers), 'منذ انضمامك')}
    ${kpi('الحسابات الاستراتيجية', `<span class="num">${now.keyAccountsActive}</span><small>/8</small>`, delta(now.keyAccountsActive, start.keyAccountsActive), '')}
    ${kpi('المدرج المالي', now.runwayMonths ? `<span class="num">${now.runwayMonths}</span> <small>شهرًا</small>` : 'رابحة', now.runwayMonths && start.runwayMonths ? delta(now.runwayMonths, start.runwayMonths, { digits: 1 }) : '', 'منذ انضمامك')}
  </div>
  <div class="grid g-3" style="margin-top:16px">
    ${chart('الإيراد الشهري (ر.س)', 'mrr', '#00C2D1')}
    ${chart('العملاء', 'customers', '#0B1F44')}
    ${chart('رضا العملاء', 'avgHealth', '#1f9d63')}
    ${chart('النقد (ر.س)', 'cash', '#F5B301')}
    ${chart('جودة المنتج', 'productQuality', '#3b5bdb')}
    ${chart('تذاكر الدعم المفتوحة', 'supportBacklog', '#d64545')}
  </div>
  <div class="grid g-2" style="margin-top:16px">
    <section class="card"><h2>خارطة الطريق</h2>${roadmapBlock(dash.roadmap, sim.state.company.roadmap)}</section>
    <section class="card"><h2>الفريق والسوق</h2>
      <div class="barrow"><span>الروح المعنوية للفريق</span><span class="num">${dash.morale}</span>${bar(dash.morale)}</div>
      <p class="small" style="margin:14px 0 0">${dash.competitors.map((c) => `${esc(c.name)}: <span class="num">${c.seatPrice}</span> ر.س`).join(' · ')}</p>
    </section>
  </div>`;
}

// ——— سجل الشركة ———

export function feed(session) {
  const days = new Map();
  for (const f of [...session.sim.feed].reverse()) {
    if (!days.has(f.day)) days.set(f.day, []);
    days.get(f.day).push(f);
  }
  return `
  <div class="page-h"><div><h1>سجل الشركة</h1><p>كل ما حدث، يومًا بيوم: نتائج قراراتك وأحداث السوق والفريق.</p></div></div>
  ${days.size ? [...days.entries()].map(([d, list]) => `<section class="card" style="margin-bottom:12px"><h2>يوم ${d}</h2>${feedList(list.reverse())}</section>`).join('')
    : '<section class="card"><div class="empty"><b>السجل فارغ</b>ستظهر هنا نتائج قراراتك بعد أول يوم عمل.</div></section>'}`;
}

// ——— تطورك المهني ———

export function report(session, ui = {}) {
  const sim = session.sim;
  if (!session.log.length) {
    return `<div class="page-h"><div><h1>تطورك المهني</h1></div></div>
    <section class="card"><div class="empty"><b>لا توجد أدلة بعد</b>سجلك المهني يُبنى من قراراتك ومستنداتك ونتائج الشركة. ابدأ بمهامك.</div></section>`;
  }
  const r = sim.report();
  const pts = computePoints(r, { finished: sim.finished });
  const { you, baselineNoActions: base } = r.companyOutcome;
  const row = (label, a, b, f = fmt) => `<tr><td>${label}</td><td class="num"><b>${f(a)}</b></td><td class="num muted">${f(b)}</td><td>${delta(a, b)}</td></tr>`;
  return `
  <div class="page-h"><div><h1>تطورك المهني</h1><p>${sim.finished ? 'التقرير النهائي لفترة عملك.' : `تقرير حتى الآن · بعد ${r.daysWorked} ${r.daysWorked === 1 ? 'يوم' : 'أيام'} عمل.`} كل درجة مرتبطة بدليل محفوظ.</p></div>
    ${sim.finished ? '<button class="btn" data-act="print">طباعة / حفظ PDF</button>' : ''}</div>
  <section class="card">
    <div class="report-head">
      <div class="score-ring">${ring(pts.points / 10)}<div style="text-align:center;position:relative"><b>${pts.points}</b><br><span>نقطة من 1000</span></div></div>
      <div>
        <div class="muted small">MOHAKI · Professional Record</div>
        <h2 style="font-size:20px;margin:2px 0 4px">${esc(r.role)}</h2>
        <p class="muted" style="margin:0 0 12px">${esc(r.company)} · بذرة العالم <span class="num">${session.seed}</span></p>
        ${r.occupation ? occupationBlock(r.occupation, r.skills) : ''}
        <p style="margin:0 0 6px"><b>نقاط القوة:</b> ${r.strengths.map(esc).join('، ')}</p>
        <p style="margin:0 0 6px"><b>للتطوير:</b> ${r.toImprove.map(esc).join('، ')}</p>
        <p style="margin:0" class="small"><b>توصية التطور:</b> ${esc(r.recommendation)}</p>
      </div>
    </div>
  </section>
  ${pointsCard(session, r)}
  ${networkCard(r.evidence.network)}
  ${quizCard(session)}
  ${realWorkCard(ui.realWork)}
  ${challengeCard(session, session.user, ui)}
  ${session.user ? portfolioCard() : ''}
  ${collabCard(ui.collab)}
  <div class="grid g-2" style="margin-top:16px">
    <section class="card"><h2>المهارات</h2>
      <div class="grid" style="gap:14px">${r.skills.map((s) => `<div class="barrow"><span>${esc(s.label)}</span><span class="num">${s.score === null ? '—' : `${s.score}%`}</span>${s.score === null ? '<div class="bar"></div>' : bar(s.score)}</div>`).join('')}</div>
    </section>
    <section class="card"><h2>أثرك على الشركة</h2>
      <p class="small muted" style="margin-top:0">مقارنة مع عالم مطابق تمامًا (نفس البذرة ونفس الأحداث) لم يتخذ فيه أحد أي قرار.</p>
      <div class="tbl-wrap"><table><thead><tr><th></th><th>أنت</th><th>دون قرارات</th><th></th></tr></thead><tbody>
        ${row('الإيراد الشهري', you.mrr, base.mrr)}
        ${row('العملاء', you.customers, base.customers)}
        ${row('الحسابات الاستراتيجية', you.keyAccountsActive, base.keyAccountsActive)}
        ${row('رضا العملاء', you.avgHealth, base.avgHealth)}
        ${row('جودة المنتج', you.productQuality, base.productQuality)}
      </tbody></table></div>
    </section>
  </div>
  <div class="grid g-2" style="margin-top:16px">
    <section class="card"><h2>القرارات التي اتخذتها <span class="pill t-pill num">${r.evidence.decisions.length}</span></h2>
      ${r.evidence.decisions.length ? `<ul class="feed">${r.evidence.decisions.map((d) => {
        const item = sim.items.find((i) => i.eventId === d.event && i.resolution?.optionId === d.option);
        const opt = item?.options.find((o) => o.id === d.option);
        return `<li><span class="d">يوم ${d.day}</span><span class="dot"></span><span><a href="#/inbox/${encodeURIComponent(item?.id ?? '')}">${esc(item?.title ?? d.event)}</a><br><span class="small">${esc(opt?.label ?? d.option)}</span></span></li>`;
      }).join('')}</ul>` : '<p class="muted small">لا قرارات بعد.</p>'}
    </section>
    <section class="card"><h2>الأعمال التي أنجزتها</h2>
      ${r.evidence.deliverables.length ? `<ul class="feed">${r.evidence.deliverables.map((d) => {
        const item = sim.items.find((i) => i.eventId === d.event);
        return `<li class="${d.score >= 0.6 ? 'good' : 'bad'}"><span class="d">يوم ${d.day}</span><span class="dot"></span><span>${esc(item?.title ?? d.event)} — <span class="num">${Math.round(d.score * 100)}%</span>${d.missing.length ? `<br><span class="small muted">${d.missing.map(esc).join('، ')}</span>` : ''}</span></li>`;
      }).join('')}</ul>` : '<p class="muted small">لم تُسلَّم مستندات بعد.</p>'}
      ${r.evidence.shipped.length ? `<h2 style="margin-top:16px">ما أُطلق خلال عملك</h2><ul class="check">${r.evidence.shipped.map((s) => `<li>${esc(s.title)} <span class="muted small">(يوم ${s.day})</span></li>`).join('')}</ul>` : ''}
    </section>
  </div>
  <p class="disclaimer" style="margin-top:16px">هذا السجل يثبت ما أنجزته داخل بيئة محاكاة افتراضية، ولا يعادل خبرة وظيفية لدى شركة حقيقية.</p>`;
}

// ——— نوافذ نهاية اليوم ———

export function endDayConfirm(session) {
  const sim = session.sim;
  const due = sim.inbox().filter((i) => i.dueDay <= sim.day);
  const later = sim.inbox().length - due.length;
  return `
  <div class="modal-h"><div class="eyebrow">يوم العمل ${sim.day}</div><h2>${due.length ? 'هناك بنود ستنتهي مهلتها' : 'إنهاء يوم العمل؟'}</h2></div>
  <div class="modal-b">
    ${due.length ? `<p style="margin-top:0">هذه البنود ستُغلق عند نهاية اليوم دون رد، ولكل منها عواقب:</p>
      <div class="items">${due.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]).map((i) => `<div class="item" style="grid-template-columns:36px 1fr"><span class="ico">${typeIcon(i.type)}</span><span><div class="tt">${esc(i.title)}</div><div class="meta"><span class="pill p-${i.priority}">${PRIORITY[i.priority]}</span></div></span></div>`).join('')}</div>`
      : `<p style="margin-top:0">ستعمل الشركة بقية اليوم: يتقدم فريق التطوير، ويتغير رضا العملاء، وتظهر نتائج قراراتك.${later ? ` لديك ${later} بنود أخرى مهلتها لم تنته بعد.` : ''}</p>`}
  </div>
  <div class="modal-f">
    <button class="btn primary" data-act="confirm-end-day">${due.length ? 'أنهِ اليوم على أي حال' : 'إنهاء يوم العمل'}</button>
    <button class="btn" data-act="close-modal">${due.length ? 'العودة للعمل' : 'إلغاء'}</button>
  </div>`;
}

export function daySummary(session, dayEnded) {
  const sim = session.sim;
  const h = sim.history;
  const now = h[h.length - 1];
  const prev = h[h.length - 2] ?? now;
  const events = sim.feed.filter((f) => f.day === dayEnded);
  const missed = sim.actions.filter((a) => a.kind === 'expired' && a.day === dayEnded)
    .map((a) => sim.items.find((i) => i.id === a.itemId)).filter(Boolean);
  const mk = (label, a, b, opts) => `<div><span>${label}</span><b>${fmt(a)}</b>${delta(a, b, opts)}</div>`;
  return `
  <div class="modal-h"><div class="eyebrow">نهاية يوم العمل ${dayEnded} · ${weekday(dayEnded)}${dayEnded % 5 === 0 && !sim.finished ? ' · بداية عطلة نهاية الأسبوع' : ''}</div><h2>هذا ما حققته بقراراتك</h2></div>
  <div class="modal-b">
    <div class="mini-kpis">
      ${mk('الإيراد الشهري', now.mrr, prev.mrr)}
      ${mk('العملاء', now.customers, prev.customers)}
      ${mk('رضا العملاء', now.avgHealth, prev.avgHealth)}
      ${mk('تذاكر الدعم', now.supportBacklog, prev.supportBacklog, { invert: true })}
    </div>
    ${events.length ? feedList(events) : '<p class="muted">يوم هادئ دون أحداث تُذكر.</p>'}
    ${missed.length ? `<div class="outcome bad" style="margin-top:14px"><h3>فات موعدها دون تصرف (${missed.length})</h3>
      <p class="small">${missed.map((i) => esc(i.title)).join('، ')}</p></div>` : ''}
  </div>
  <div class="modal-f">
    ${sim.finished ? '<button class="btn teal" data-act="go-report">افتح سجلك المهني</button>'
      : `<button class="btn primary" data-act="close-modal">ابدأ يوم العمل ${sim.day} (${weekday(sim.day)})</button>`}
  </div>`;
}

export function resetConfirm() {
  return `
  <div class="modal-h"><div class="eyebrow">ابدأ من جديد</div><h2>هل تريد بدء الشهر من اليوم الأول؟</h2></div>
  <div class="modal-b"><p style="margin-top:0">ستُحذف كل قراراتك ومستنداتك في هذه التجربة، ويبدأ عالم جديد بأحداث عشوائية مختلفة.</p></div>
  <div class="modal-f"><button class="btn primary" data-act="confirm-reset">نعم، ابدأ من جديد</button><button class="btn" data-act="close-modal">إلغاء</button></div>`;
}

// ——— غرفة الاجتماع ———

export function modeLabel(mode) {
  return {
    claude: 'أدار الحوار وكلاء ذكاء اصطناعي (Claude)',
    offline: 'أدار الحوار الوضع المحلي القائم على القواعد',
    mixed: 'أدار الحوار Claude مع تحويل جزئي إلى الوضع المحلي',
    reviewed: 'راجع المُيسِّر هذا الحكم وصحّحه',
    human: 'أدار الحوار بشر في جلسة حية، وحكم فيه المُيسِّر',
  }[mode] ?? '';
}

function minutes(session, transcript, { pending = false, full = false, pendingText = 'المشاركون يردّون…' } = {}) {
  return `<div class="minutes ${full ? 'full' : ''}" ${full ? '' : 'data-minutes'}>${transcript.map((l) => {
    const me = l.speaker === 'trainee';
    const p = me ? { id: 'me', name: 'أنت' } : session.person(l.speaker);
    return `<div class="bubble ${me ? 'me' : ''}">${me ? '<span class="avatar sm me-av" aria-hidden="true">أنت</span>' : avatar(p, 'sm')}
      <div><div class="who">${esc(p.name)}${!me && p.title ? ` <span class="muted">· ${esc(p.title)}</span>` : ''}</div><div class="said">${esc(l.text)}</div></div></div>`;
  }).join('')}${pending ? `<div class="bubble typing" aria-live="polite"><span class="dots"><i></i><i></i><i></i></span><span class="muted small">${esc(pendingText)}</span></div>` : ''}</div>`;
}

const ROOM_TEXT = {
  meeting: { join: 'ادخل الاجتماع', say: 'ردك في الاجتماع', close: 'اختتام الاجتماع', pending: 'المشاركون يردّون…', intro: (n) => `ستتحدث بحرية. لديك ${n} جولات للرد، ثم يحسم رئيس الاجتماع القرار.` },
  chat: { join: 'ابدأ المحادثة', say: 'ردك', close: 'إنهاء المحادثة', pending: 'يكتب…', intro: (n) => `اكتب ردك بحرية كما تكتب رسالة عمل. لديك ${n} ${n === 2 ? 'ردّان' : 'ردود'}، ثم تُحسم المحادثة.` },
};
export const roomText = (spec) => ROOM_TEXT[spec?.mode === 'chat' ? 'chat' : 'meeting'];

function meetingRoom(session, item, ui) {
  const spec = item.dialogue;
  const tx = roomText(spec);
  const m = ui.meetings?.[item.id];
  const people = spec.participants.map((id) => session.person(id));
  const badge = ui.agentRoutes?.[spec.mode === 'chat' ? 'chat' : 'meeting'] === 'claude'
    ? '<span class="pill p-normal">وكلاء Claude</span>'
    : '<span class="pill t-pill">الوضع المحلي</span>';
  const roster = `<div class="roster">${people.map((p) => `<div class="att">${avatar(p, 'sm')}<span>${esc(p.name.replace(/^م\.\s*/, ''))}<small>${esc(p.title)}</small></span></div>`).join('')}<div class="att">${badge}</div></div>`;
  if (!m) {
    return `${roster}
    <div class="actions"><button class="btn primary" type="button" data-act="join-meeting" data-item="${esc(item.id)}">${tx.join}</button>
    <span class="muted small">${tx.intro(spec.maxRounds ?? 3)}</span></div>`;
  }
  const pending = ui.pendingMeeting === item.id;
  const left = m.maxRounds - m.round;
  return `${roster}
    <div class="concerns">${spec.concerns.map((c) => `<div class="concern ${m.addressed[c.id] ? 'ok' : ''}">
      <span class="st">${m.addressed[c.id] ? '✓' : '•'}</span>
      <span><b>${esc(session.person(c.owner).name)}</b> — ${esc(c.label)}</span>
      <span class="pill ${m.addressed[c.id] ? 's-done' : 'p-high'}">${m.addressed[c.id] ? 'أُجيب' : 'مفتوح'}</span></div>`).join('')}</div>
    ${minutes(session, m.transcript, { pending, pendingText: spec.mode === 'chat' ? `${session.person(spec.chair).name} ${tx.pending}` : tx.pending })}
    ${m.closed ? '' : `<form data-form="meeting" data-item="${esc(item.id)}" class="meeting-form">
      <div class="field">
        <label for="say">${tx.say} <span class="muted small">· ${left > 0 ? `الجولة ${m.round + 1} من ${m.maxRounds}` : 'انتهت الجولات'}</span></label>
        <textarea id="say" name="message" rows="4" maxlength="1500" data-draft="${esc(item.id)}" data-draft-field="say" ${pending || left <= 0 ? 'disabled' : ''}
          placeholder="${esc(spec.placeholder ?? 'تحدث إلى الحاضرين.')}">${esc(ui.drafts?.[item.id]?.say ?? '')}</textarea>
      </div>
      <div class="actions">
        <button class="btn primary" type="submit" ${pending || left <= 0 ? 'disabled' : ''}>إرسال</button>
        <button class="btn" type="button" data-act="close-meeting" data-item="${esc(item.id)}" ${pending || m.round < 1 ? 'disabled' : ''}>${tx.close}</button>
        ${ui.meetingNote ? `<span class="muted small">${esc(ui.meetingNote)}</span>` : ''}
      </div>
    </form>`}`;
}

// ——— التصنيف السعودي الموحد للمهن ———

function occupationRow(data, roleId) {
  const o = data && roleId ? roleOccupation(data, roleId) : null;
  if (!o) return '';
  return `<dt>التصنيف السعودي</dt><dd>${occupationLabel(o)}</dd>`;
}

function occupationLabel(o) {
  const name = o.code ? `<span class="num">${esc(o.code)}</span> ${esc(o.titleAr ?? '')}` : `المجموعة <span class="num">${esc(o.unitGroup)}</span>`;
  return `${name} <span class="pill ${o.status === 'official' ? 's-done' : 'p-high'}">${esc(o.statusLabel)}</span>${o.matchLabel ? ` <span class="pill t-pill">${esc(o.matchLabel)}</span>` : ''}`;
}

function occupationBlock(o, skills = []) {
  const skill = (id) => skills.find((x) => x.id === id);
  const comps = o.profile?.behavioralCompetencies ?? [];
  return `<div class="occupation">
    <div class="small"><b>وفق التصنيف السعودي الموحد للمهن:</b> ${occupationLabel(o)}</div>
    ${comps.length && o.competencyEvidence ? `<div class="comps">
      <div class="small muted">الجدارات السلوكية الرسمية للمهنة، وما يقابلها من أدلة في محاكي:</div>
      <div class="tag-list">${comps.map((c) => {
        const sk = skill(o.competencyEvidence[c]);
        return sk && sk.score !== null
          ? `<span class="pill s-done">${esc(c)} · ${esc(sk.label)} <span class="num">${sk.score}%</span></span>`
          : `<span class="pill t-pill">${esc(c)} · لم تُقَس بعد</span>`;
      }).join('')}</div></div>` : ''}
    <details class="small"><summary>المهام الرسمية للمهنة والمصدر</summary>
      ${o.profile ? `<p>${esc(o.profile.summary)}</p><ul>${o.profile.tasks.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        <p>المؤهل: ${esc(o.profile.qualification ?? '—')} · الجدارات الفنية: ${o.profile.technicalCompetencies.map(esc).join('، ')}</p>` : ''}
      ${o.matchReason ? `<p><b>سبب الاختيار:</b> ${esc(o.matchReason)}</p>` : ''}
      <p>المجموعة الأولية <span class="num">${esc(o.unitGroup)}</span> (ISCO-08: ${esc(o.unitGroupTitle ?? '')}).</p>
      ${o.source ? `<p>المصدر: ${o.source.url ? `<a href="${esc(o.source.url)}" target="_blank" rel="noopener">${esc(o.source.title)}</a>` : esc(o.source.title)}${o.source.decision ? ` · ${esc(o.source.decision)}` : ''}${o.source.official ? '' : ' (غير رسمي)'}</p>` : ''}
      ${o.note ? `<p>${esc(o.note)}</p>` : ''}
      ${o.saudization ? `<p>التوطين: <span class="num">${Math.round(o.saudization.rate * 100)}%</span> ابتداءً من <span class="num">${esc(o.saudization.effective)}</span>.</p>` : ''}
    </details>
  </div>`;
}

// ——— مراسلة زميل ———

const firstName = (p) => (p.name || '').replace(/^(م\.|أ\.)\s*/, '').split(' ')[0];

export function colleagueChat(session, person, ui = {}) {
  const sim = session.sim;
  if (!canMessage(person)) return `<section class="card"><div class="empty"><b>لا يمكن مراسلة هذا الشخص</b><a href="#/team">العودة إلى فريقي</a></div></section>`;
  const thread = session.thread(person.id);
  const left = DAILY_LIMIT - session.sentToday(person.id);
  const pending = ui.pendingColleague === person.id;
  const disabled = pending || left <= 0 || sim.finished;
  const t = sim.state.player.trust[person.id];
  const topics = [...new Set((person.knowledge ?? []).map((k) => k.keywords[0]))].slice(0, 5);
  let lastDay = null;
  const bubbles = thread.map((m) => {
    const sep = m.day !== lastDay ? `<div class="day-sep"><span>يوم العمل ${m.day}</span></div>` : '';
    lastDay = m.day;
    const me = m.speaker === 'trainee';
    return `${sep}<div class="bubble ${me ? 'me' : ''}">${me ? '<span class="avatar sm me-av" aria-hidden="true">أنت</span>' : avatar(person, 'sm')}
      <div><div class="who">${me ? 'أنت' : esc(person.name)}</div><div class="said">${esc(m.text)}</div></div></div>`;
  }).join('');
  return `
  <div class="page-h"><div><a href="#/team" class="small" style="text-decoration:none">→ فريقي</a><h1>مراسلة ${esc(person.name)}</h1><p>${esc(person.title)}</p></div>
    <span class="pill ${ui.agentRoutes?.colleague === 'claude' ? 'p-normal' : 't-pill'}">${ui.agentRoutes?.colleague === 'claude' ? 'وكلاء Claude' : 'الوضع المحلي'}</span></div>
  <div class="grid g-main">
    <section class="card detail">
      <div class="minutes chat-thread" data-minutes>
        ${bubbles || `<div class="empty" style="padding:28px 12px"><b>ابدأ المراسلة</b>${esc(firstName(person))} يجيب مما يعرفه عن الشركة الآن.</div>`}
        ${pending ? `<div class="bubble typing" aria-live="polite"><span class="dots"><i></i><i></i><i></i></span><span class="muted small">${esc(firstName(person))} يكتب…</span></div>` : ''}
      </div>
      <form data-form="colleague" data-person="${esc(person.id)}">
        <div class="field">
          <label for="msg">رسالتك <span class="muted small">· ${sim.finished ? 'انتهت فترة العمل' : left > 0 ? `متبقٍ اليوم: ${left} من ${DAILY_LIMIT}` : 'انتهت رسائل اليوم، تابع غدًا'}</span></label>
          <textarea id="msg" name="message" rows="3" maxlength="800" data-draft="colleague:${esc(person.id)}" ${disabled ? 'disabled' : ''}
            placeholder="${esc(topics.length ? `اسأل سؤالًا محددًا. ${firstName(person)} يعرف عن: ${topics.join('، ')}.` : 'اسأل سؤالًا محددًا.')}">${esc(ui.drafts?.[`colleague:${person.id}`] ?? '')}</textarea>
        </div>
        ${topics.length ? `<div class="tag-list" style="margin:8px 0">${topics.map((x) => `<button type="button" class="pill t-pill chip" data-act="suggest" data-text="${esc(`أريد أن أعرف عن ${x}`)}" ${disabled ? 'disabled' : ''}>${esc(x)}</button>`).join('')}</div>` : ''}
        <div class="actions"><button class="btn primary" type="submit" ${disabled ? 'disabled' : ''}>إرسال</button>
          ${ui.colleagueNote ? `<span class="muted small">${esc(ui.colleagueNote)}</span>` : ''}</div>
      </form>
    </section>
    <section class="card person">${avatar(person)}<div style="flex:1;min-width:0">
      <div class="nm">${esc(person.name)}</div><div class="ti">${esc(person.title)}</div>
      <div class="pe">${esc(person.persona)}</div>
      ${t !== undefined ? `<div class="barrow"><span>ثقته بك</span><span class="num">${Math.round(t)}</span>${bar(t)}</div>` : ''}
      <p class="small muted" style="margin:12px 0 0">المراسلة لجمع المعلومات: لا تغيّر نتائج الشركة ولا تُقيَّم. القرارات تُتخذ في مهامك واجتماعاتك.</p>
    </div></section>
  </div>`;
}

// ——— النقاط والسجل الموثّق ———

function pointsCard(session, r) {
  const sim = session.sim;
  const p = computePoints(r, { finished: sim.finished });
  const user = session.user;
  const issued = session.issuedRecord;
  let action;
  if (!sim.finished) {
    action = `<p class="small muted" style="margin:0">يُصدر سجل الأداء الموثّق بعد إكمال ${sim.lastDay} يوم عمل. متبقٍ: <span class="num">${sim.lastDay - sim.day + 1}</span>.</p>`;
  } else if (!user) {
    action = `<div class="actions"><button class="btn teal" data-act="open-auth" data-mode="register">أنشئ حسابًا لإصدار سجلك الموثّق</button></div>`;
  } else if (!user.emailVerified) {
    action = `<div class="actions"><span class="small">أكّد بريدك الإلكتروني أولًا لإصدار السجل الموثّق.</span><button class="btn sm" data-act="resend-verification">إعادة إرسال رابط التأكيد</button></div>`;
  } else if (issued) {
    action = `<div class="actions"><a class="btn teal" href="#/verify/${esc(issued.code)}">عرض السجل الموثّق <span class="num">${esc(issued.code)}</span></a><button class="btn" data-act="copy-verify" data-code="${esc(issued.code)}">نسخ رابط التحقق</button></div>`;
  } else {
    action = `<div class="actions"><button class="btn teal" data-act="issue-record">إصدار سجل الأداء الموثّق</button>
      <span class="small muted">يعيد الخادم تشغيل كل قراراتك ويحسب النتيجة بنفسه قبل الإصدار.</span></div>`;
  }
  let rec = '';
  if (sim.finished) {
    if (p.recommendable && user?.consents?.employerSharing) rec = '<div class="outcome good"><b>مؤهل للتوصية:</b> سيظهر سجلك لجهات التوظيف الشريكة، لأنك وافقت على ذلك. يمكنك سحب الموافقة في أي وقت من حسابك.</div>';
    else if (p.recommendable) rec = '<div class="outcome info"><b>أنت مؤهل للتوصية لجهات التوظيف.</b> لن يُشارك سجلك إلا إذا فعّلت الموافقة من <a href="#/account">حسابي</a>.</div>';
    else rec = `<div class="outcome info"><b>للتأهل للتوصية:</b> <span class="num">${RECOMMENDATION_RULES.minPoints}</span> نقطة على الأقل، وألا تقل أي مهارة عن <span class="num">${RECOMMENDATION_RULES.minSkill}%</span>.${p.weakest ? ` أضعف مهارة لديك: ${esc(p.weakest.label)} (<span class="num">${p.weakest.score}%</span>).` : ''}</div>`;
  }
  return `<section class="card points-card" style="margin-top:16px">
    <h2>كيف تُحسب نقاطك <span class="pill ${p.band.id === 'developing' ? 'p-high' : 's-done'}">${esc(p.band.label)}</span></h2>
    <div class="points-head">
      <div class="small muted">كل مهارة بنسبتها مضروبة في وزنها المعلن. الشرائح: <b>متميز</b> 850+ · <b>جاهز لسوق العمل</b> 700+ · <b>واعد</b> 550+ · <b>قيد التطوير</b> دون ذلك.</div>
      <div class="breakdown">${p.breakdown.map((b) => `<div class="barrow"><span>${esc(b.label)} <span class="muted small">(وزن ${b.weight}%)</span></span><span class="num">${b.points}</span>${bar(b.score)}</div>`).join('')}</div>
    </div>
    ${rec}
    ${action}
  </section>`;
}

// ——— التسجيل والدخول ———

export function authModal(mode = 'register', error = '') {
  const reg = mode === 'register';
  return `
  <div class="modal-h"><div class="eyebrow">${reg ? 'حساب جديد' : 'تسجيل الدخول'}</div><h2>${reg ? 'أنشئ حسابك في محاكي' : 'مرحبًا بعودتك'}</h2></div>
  <form class="modal-b auth-form" data-form="auth" data-mode="${mode}">
    ${error ? `<div class="outcome bad" style="margin-bottom:12px">${esc(error)}</div>` : ''}
    ${reg ? `<div class="field"><label for="a-name">الاسم كما تريد أن يظهر في سجلك</label><input id="a-name" name="name" required minlength="3" autocomplete="name"></div>` : ''}
    <div class="field"><label for="a-email">البريد الإلكتروني</label><input id="a-email" name="email" type="email" required autocomplete="email" dir="ltr"></div>
    <div class="field"><label for="a-pass">كلمة المرور ${reg ? '<span class="muted small">(8 أحرف على الأقل)</span>' : ''}</label><input id="a-pass" name="password" type="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}" dir="ltr"></div>
    ${reg ? `
    <details class="optional"><summary>معلومات إضافية (اختيارية، تظهر لجهات التوظيف إن وافقت)</summary>
    <div class="grid g-2" style="gap:10px;margin-top:8px">
      <div class="field"><label for="a-uni">الجامعة</label><input id="a-uni" name="university"></div>
      <div class="field"><label for="a-major">التخصص</label><input id="a-major" name="major"></div>
      <div class="field"><label for="a-year">سنة التخرج</label><input id="a-year" name="graduationYear" type="number" min="1990" max="2040" dir="ltr"></div>
      <div class="field"><label for="a-city">المدينة</label><input id="a-city" name="city"></div>
    </div></details>
    <label class="consent"><input type="checkbox" name="processing" required>
      <span><b>أوافق على معالجة بياناتي لأغراض التدريب والتقييم داخل محاكي</b> (مطلوب). تُحفظ قراراتك ومحادثاتك ونتائجك لحساب سجلك المهني. لا نطلب رقم الهوية، ورقم الجوال اختياري في صفحتك.</span></label>
    <label class="consent"><input type="checkbox" name="employerSharing">
      <span><b>أوافق على مشاركة سجلي وبيانات التواصل مع جهات توظيف شريكة لمحاكي</b> (اختياري). لا يُشارك إلا إذا استوفيت شروط التوصية، ويمكنك سحب الموافقة في أي وقت.</span></label>
    <label class="consent"><input type="checkbox" name="peerReview">
      <span><b>أوافق على عرض مستنداتي على متدربين آخرين لمراجعتها دون اسمي</b> (اختياري). تصلك ملاحظاتهم، ولا تؤثر على نقاطك.</span></label>` : ''}
    <div class="actions">
      <button class="btn primary" type="submit">${reg ? 'إنشاء الحساب' : 'دخول'}</button>
      <button class="btn ghost" type="button" data-act="open-auth" data-mode="${reg ? 'login' : 'register'}">${reg ? 'لدي حساب' : 'ليس لدي حساب'}</button>
      ${reg ? '' : '<button class="btn ghost" type="button" data-act="open-forgot">نسيت كلمة المرور؟</button>'}
      <button class="btn ghost" type="button" data-act="close-modal">إلغاء</button>
    </div>
  </form>`;
}

export function guestWall() {
  return `
  <div class="modal-h"><div class="eyebrow">تقدمك محفوظ</div><h2>أنشئ حسابًا لتكمل أسبوعك</h2></div>
  <div class="modal-b"><p style="margin-top:0">جربت يومك الأول كضيف. لتكمل بقية الأيام، أنشئ حسابًا مجانيًا. سيُنقل تقدمك كما هو، وستتمكن من المتابعة على أي جهاز، وإصدار سجلك الموثّق في النهاية.</p></div>
  <div class="modal-f"><button class="btn primary" data-act="open-auth" data-mode="register">إنشاء حساب</button><button class="btn" data-act="open-auth" data-mode="login">لدي حساب</button><button class="btn ghost" data-act="close-modal">لاحقًا</button></div>`;
}

// ——— حسابي ———

export function accountPage(session, user) {
  if (!user) return `<section class="card"><div class="empty"><b>لست مسجلًا</b><button class="btn primary" data-act="open-auth" data-mode="register">أنشئ حسابًا</button></div></section>`;
  const p = user.profile ?? {};
  return `
  <div class="page-h"><div><h1>حسابي</h1><p><span dir="ltr">${esc(user.email)}</span> ${user.emailVerified ? '<span class="pill s-done">بريد مؤكد</span>' : '<span class="pill p-high">بريد غير مؤكد</span> <button class="btn sm" data-act="resend-verification">إعادة إرسال التأكيد</button>'}</p></div></div>
  <div class="grid g-2">
    <section class="card">
      <h2>الملف الشخصي</h2>
      <form data-form="profile" class="grid" style="gap:10px">
        <div class="field"><label for="p-name">الاسم كما يظهر في السجل</label><input id="p-name" name="name" value="${esc(user.name)}" required minlength="3"></div>
        <div class="field"><label for="p-uni">الجامعة</label><input id="p-uni" name="university" value="${esc(p.university ?? '')}"></div>
        <div class="field"><label for="p-major">التخصص</label><input id="p-major" name="major" value="${esc(p.major ?? '')}"></div>
        <div class="grid g-2" style="gap:10px">
          <div class="field"><label for="p-year">سنة التخرج</label><input id="p-year" name="graduationYear" type="number" min="1990" max="2040" value="${esc(p.graduationYear ?? '')}" dir="ltr"></div>
          <div class="field"><label for="p-city">المدينة</label><input id="p-city" name="city" value="${esc(p.city ?? '')}"></div>
        </div>
        <div class="actions"><button class="btn primary" type="submit">حفظ</button></div>
      </form>
    </section>
    <section class="card">
      <h2>الموافقات</h2>
      <label class="consent"><input type="checkbox" checked disabled><span><b>معالجة البيانات لأغراض التدريب</b>: مطلوبة لاستخدام المنصة. لسحبها احذف حسابك.</span></label>
      <label class="consent"><input type="checkbox" data-act="toggle-sharing" ${user.consents?.employerSharing ? 'checked' : ''}><span><b>مشاركة سجلي وبيانات التواصل مع جهات توظيف شريكة</b>: يمكنك تفعيلها أو سحبها في أي وقت، ويُسجَّل تاريخ كل تغيير.</span></label>
      <label class="consent"><input type="checkbox" data-act="toggle-digest" ${user.prefs?.dailyDigest ? 'checked' : ''}><span><b>الملخص اليومي على بريدي</b>: بعد كل يوم عمل في المحاكاة تصلك رسالة بأرقام الشركة وما حدث وما ينتظرك (رسالة واحدة في اليوم كحد أقصى).</span></label>
      <label class="consent"><input type="checkbox" data-act="toggle-ai" ${user.consents?.aiTraining ? 'checked' : ''}><span><b>استخدام محادثاتي مع الزميل الحقيقي لتحسين المحاكاة</b>: دون اسمي، وفقط إذا وافق زميلي أيضًا. يمكنك سحبها في أي وقت.</span></label>
      <label class="consent"><input type="checkbox" data-act="toggle-peer" ${user.consents?.peerReview ? 'checked' : ''}><span><b>عرض مستنداتي على متدربين آخرين لمراجعتها دون اسمي</b>: إن سحبتها، لا تُكلَّف مستنداتك لمراجعات جديدة.</span></label>
      <h2 style="margin-top:18px">سجلاتي الموثّقة</h2>
      ${user.records?.length ? `<ul class="feed">${user.records.map((c) => `<li><span class="d"></span><span class="dot"></span><a href="#/verify/${esc(c)}" class="num">${esc(c)}</a></li>`).join('')}</ul>` : '<p class="small muted">لم تُصدر سجلًا بعد. يُصدر بعد إكمال التجربة.</p>'}
      <h2 style="margin-top:18px">الحساب</h2>
      <div class="actions"><button class="btn" data-act="logout">تسجيل الخروج</button><button class="btn danger" data-act="delete-account">حذف الحساب وبياناتي</button></div>
    </section>
  </div>`;
}

export function deleteConfirm() {
  return `
  <div class="modal-h"><div class="eyebrow">حذف الحساب</div><h2>هل تريد حذف حسابك وبياناتك نهائيًا؟</h2></div>
  <div class="modal-b"><p style="margin-top:0">سيُحذف حسابك وتقدمك ومحادثاتك، <b>وتُلغى سجلاتك الموثّقة</b> فلا تعود صالحة للتحقق. لا يمكن التراجع.</p></div>
  <div class="modal-f"><button class="btn danger" data-act="confirm-delete">نعم، احذف</button><button class="btn" data-act="close-modal">إلغاء</button></div>`;
}

// ——— صفحة التحقق العامة ———

export function verifyPage(state) {
  const frame = (inner) => `<div class="verify-wrap"><div class="brand verify-brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>${inner}
    <p class="disclaimer verify-note">يوثّق هذا السجل أداءً في بيئة محاكاة افتراضية. <b>ليس شهادة خبرة أو شهادة خدمة لدى جهة عمل</b>، ولا شهادة تدريب معتمدة. NOVA TECH شركة افتراضية.</p></div>`;
  if (state.loading) return frame('<section class="card"><div class="empty">جارٍ التحقق…</div></section>');
  if (state.error) return frame(`<section class="card"><div class="empty"><b>لا يوجد سجل بهذا الرمز</b>${esc(state.error)}</div></section>`);
  const r = state.record;
  if (r.revoked) return frame(`<section class="card"><div class="outcome bad"><h3>السجل <span class="num">${esc(r.code)}</span> ملغى</h3><p>أُلغي هذا السجل بطلب صاحبه أو بحذف حسابه، فلم يعد صالحًا للتحقق.</p></div></section>`);
  const d = (iso) => (iso ? new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory', { year: 'numeric', month: 'long', day: 'numeric' }) : '—');
  return frame(`
  <section class="card certificate">
    <div class="cert-top"><span class="pill s-done">✓ سجل موثّق ومتحقق منه</span><span class="num muted">${esc(r.code)}</span></div>
    <div class="muted small">سجل الأداء المهني الموثّق</div>
    <h1>${esc(r.name)}</h1>
    <p class="cert-role">أكمل تجربة محاكاة عمل بدور <b>${esc(r.role)}</b> في شركة <b>${esc(r.company)}</b> الافتراضية، لمدة <span class="num">${r.days}</span> يوم عمل.</p>
    ${r.occupation ? `<p class="small">المهنة وفق التصنيف السعودي الموحد للمهن: <span class="num">${esc(r.occupation.code)}</span> ${esc(r.occupation.titleAr)}</p>` : ''}
    <div class="cert-score">
      <div><div class="points"><span class="num">${r.points}</span><small> / 1000</small></div><span class="pill s-done">${esc(r.band.label)}</span></div>
      <div class="breakdown">${r.breakdown.map((b) => `<div class="barrow"><span>${esc(b.label)}</span><span class="num">${b.score}%</span>${bar(b.score)}</div>`).join('')}</div>
    </div>
    ${r.realWork?.count ? `<p class="small"><b>أعمال واقعية معتمدة</b> (منفصلة عن نقاط المحاكاة): ${r.realWork.items.map((x) => `${esc(x.title)} لدى ${esc(x.org)} (تقييم <span class="num">${x.rating}</span> من 5)`).join('، ')} · <span class="num">${r.realWork.points}</span> نقطة إنجاز واقعي.</p>` : ''}
    ${r.appraisal ? `<p class="small"><b>فترة التجربة (${esc(r.appraisal.role.title)}):</b> ${esc(r.appraisal.decision.label)} · حقق <span class="num">${r.appraisal.achieved}</span> من <span class="num">${r.appraisal.total}</span> أهداف${r.appraisal.violations ? ` · ${r.appraisal.violations} تجاوزات للإجراءات` : ' · دون تجاوزات للصلاحيات والإجراءات'}.</p>` : ''}
    ${r.marketResearch?.confirmed ? `<p class="small"><b>أبحاث سوق معتمدة</b> (منفصلة عن نقاط المحاكاة): <span class="num">${r.marketResearch.confirmed}</span> أبحاث طابقت الجواب المعتمد من مصادر مستقلة · <span class="num">${r.marketResearch.points}</span> نقطة بحث.</p>` : ''}
    ${r.collaboration && (r.collaboration.rolesPlayed || r.collaboration.reviewsGiven) ? `<p class="small"><b>التعاون ودعم الزملاء</b> (منفصل عن النقاط): لعب <span class="num">${r.collaboration.rolesPlayed}</span> دورًا في جلسات زملائه${r.collaboration.avgRoleRating ? ` بتقييم <span class="num">${r.collaboration.avgRoleRating}</span> من 5` : ''} · راجع <span class="num">${r.collaboration.reviewsGiven}</span> مستندًا، وجد أصحابها <span class="num">${r.collaboration.reviewsHelpful}</span> منها مفيدة.</p>` : ''}
    <p class="small">الأدلة: <span class="num">${r.evidence.decisions}</span> قرارًا وحوارًا · <span class="num">${r.evidence.deliverables}</span> مستندات · أُطلق خلال عمله: ${r.evidence.shipped.map(esc).join('، ') || '—'}</p>
    <p class="small muted">تاريخ الإصدار: ${d(r.issuedAt)} · احتُسبت النتيجة بإعادة تشغيل كل القرارات على خادم محاكي · بصمة سجل الأفعال: <span class="num" style="word-break:break-all">${esc(r.logHash.slice(0, 16))}…</span></p>
    <div class="actions no-print"><button class="btn" data-act="print">طباعة / حفظ PDF</button><a class="btn ghost" href="#/desk">إلى محاكي</a></div>
  </section>`);
}

// ——— تأكيد البريد واستعادة كلمة المرور ———

const publicFrame = (inner) => `<div class="verify-wrap"><div class="brand verify-brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>${inner}</div>`;

export function forgotModal(message = '', error = '') {
  return `
  <div class="modal-h"><div class="eyebrow">استعادة الحساب</div><h2>نسيت كلمة المرور؟</h2></div>
  <form class="modal-b" data-form="forgot">
    ${message ? `<div class="outcome good" style="margin-bottom:12px">${esc(message)}</div>` : '<p style="margin-top:0">أدخل بريدك، وسنرسل لك رابطًا لتعيين كلمة مرور جديدة.</p>'}
    ${error ? `<div class="outcome bad" style="margin-bottom:12px">${esc(error)}</div>` : ''}
    <div class="field"><label for="f-email">البريد الإلكتروني</label><input id="f-email" name="email" type="email" required autocomplete="email" dir="ltr"></div>
    <div class="actions"><button class="btn primary" type="submit">إرسال الرابط</button><button class="btn ghost" type="button" data-act="open-auth" data-mode="login">العودة للدخول</button></div>
  </form>`;
}

export function confirmEmailPage(state) {
  if (state.loading) return publicFrame('<section class="card"><div class="empty">جارٍ تأكيد بريدك…</div></section>');
  if (state.error) return publicFrame(`<section class="card"><div class="outcome bad"><h3>تعذر تأكيد البريد</h3><p>${esc(state.error)}</p></div>
    <div class="actions"><a class="btn primary" href="#/account">اطلب رابطًا جديدًا من حسابي</a></div></section>`);
  return publicFrame(`<section class="card"><div class="outcome good"><h3>تم تأكيد بريدك ✓</h3><p>يمكنك الآن إصدار سجل الأداء الموثّق عند إكمال التجربة، ومشاركته مع جهات التوظيف إن وافقت.</p></div>
    <div class="actions"><a class="btn primary" href="#/desk">إلى محاكي</a></div></section>`);
}

export function resetPasswordPage(state = {}) {
  if (state.done) return publicFrame(`<section class="card"><div class="outcome good"><h3>تم تعيين كلمة المرور ✓</h3><p>سُجّل دخولك، وأُخرجت أي جلسات أخرى مفتوحة على حسابك.</p></div>
    <div class="actions"><a class="btn primary" href="#/desk">إلى محاكي</a></div></section>`);
  return publicFrame(`<section class="card">
    <h1 style="font-size:22px;margin-top:0">تعيين كلمة مرور جديدة</h1>
    ${state.error ? `<div class="outcome bad" style="margin-bottom:12px">${esc(state.error)}</div>` : ''}
    <form data-form="reset" class="grid" style="gap:10px">
      <div class="field"><label for="r-pass">كلمة المرور الجديدة <span class="muted small">(8 أحرف على الأقل)</span></label><input id="r-pass" name="password" type="password" minlength="8" required autocomplete="new-password" dir="ltr"></div>
      <div class="field"><label for="r-pass2">تأكيد كلمة المرور</label><input id="r-pass2" name="password2" type="password" minlength="8" required autocomplete="new-password" dir="ltr"></div>
      <div class="actions"><button class="btn primary" type="submit">حفظ كلمة المرور</button></div>
    </form>
    <p class="small muted">بعد الحفظ تُنهى كل الجلسات المفتوحة على حسابك في الأجهزة الأخرى.</p>
  </section>`);
}

// ——— لوحة المُيسِّر ———

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);
const AGENT_MODE = { claude: 'Claude', offline: 'الوضع المحلي', mixed: 'مختلط', reviewed: 'مُصحَّح', human: 'جلسة حية' };

export function facilitatorPage(world, state) {
  const people = world.company.people;
  const nameOf = (id) => (id === 'trainee' ? 'المتدرب' : people.find((p) => p.id === id)?.name ?? id);
  const cal = state.calibration;
  const list = state.list ?? [];
  const sel = list.find((d) => `${d.userId}|${d.itemId}` === state.selected) ?? list[0];
  const tab = (id, label) => `<button class="${state.filter === id ? 'on' : ''}" data-act="fac-filter" data-filter="${id}">${label}</button>`;
  const calCards = cal && Object.keys(cal.byAgentMode).length
    ? Object.entries(cal.byAgentMode).map(([mode, g]) => `<section class="card kpi"><div class="k-l">اتفاق ${esc(AGENT_MODE[mode] ?? mode)} مع المُيسِّر</div>
        <div class="k-v"><span class="num">${pct(g.concernAgreement)}</span></div><span class="muted small">في الحكم على الاعتراضات · <span class="num">${pct(g.decisionAgreement)}</span> في النتيجة · <span class="num">${g.dialogues}</span> حوارًا</span></section>`).join('')
    : '<section class="card"><p class="muted small" style="margin:0">لا توجد مراجعات بعد. كل حوار تراجعه يضيف إلى المقارنة بين حكم الوكيل وحكمك، وهي ما نحتاجه لمعايرة النموذج.</p></section>';
  const row = (d) => `<button class="item fac-row ${d === sel ? 'on' : ''}" data-act="fac-select" data-key="${esc(`${d.userId}|${d.itemId}`)}" style="text-align:right;width:100%;border:0;background:none">
      <span class="ico">${typeIcon(d.kind === 'chat' ? 'message' : 'meeting')}</span>
      <span><div class="tt">${esc(d.title)}</div><div class="meta"><span>${esc(d.userName)}</span><span class="pill t-pill">${esc(AGENT_MODE[d.agentMode] ?? d.agentMode)}</span>${d.review ? '<span class="pill s-done">مراجَع</span>' : ''}</div></span>
      <span></span></button>`;
  let detail = '<div class="empty"><b>لا توجد حوارات هنا</b>ستظهر حوارات المتدربين بعد أن يكملوها.</div>';
  if (sel) {
    const cur = sel.review ?? sel.ai;
    const aiOpt = sel.options.find((o) => o.id === sel.ai.optionId)?.label;
    detail = `
      <div class="chips"><span class="pill t-pill">${sel.kind === 'chat' ? 'محادثة' : 'اجتماع'}</span><span class="pill t-pill">${esc(sel.userName)}</span><span class="pill t-pill">أدارها: ${esc(AGENT_MODE[sel.agentMode] ?? sel.agentMode)}</span></div>
      <h1>${esc(sel.title)}</h1>
      <div class="minutes full">${sel.transcript.map((l) => `<div class="bubble ${l.speaker === 'trainee' ? 'me' : ''}"><div><div class="who">${esc(nameOf(l.speaker))}</div><div class="said">${esc(l.text)}</div></div></div>`).join('')}</div>
      <div class="outcome info" style="margin:12px 0"><b>حكم الوكيل:</b> ${sel.ai.addressed.length} من ${sel.concerns.length} اعتراضات مجابة · النتيجة: ${esc(aiOpt ?? sel.ai.optionId)}</div>
      ${sel.review ? `<p class="small muted">راجعه ${esc(sel.review.byName)} في ${esc(new Date(sel.review.at).toLocaleDateString('ar-SA-u-ca-gregory'))}.</p>` : ''}
      <form data-form="fac-review" data-user="${esc(sel.userId)}" data-item="${esc(sel.itemId)}">
        <h2 class="section-t">حكمك على الاعتراضات</h2>
        ${sel.concerns.map((c) => `<label class="consent"><input type="checkbox" name="addressed" value="${esc(c.id)}" ${cur.addressed.includes(c.id) ? 'checked' : ''}>
          <span><b>${esc(nameOf(c.owner))} — ${esc(c.label)}</b>${sel.ai.addressed.includes(c.id) !== cur.addressed.includes(c.id) ? ' <span class="pill p-high">يختلف عن الوكيل</span>' : ''}<br><span class="small muted">${esc(c.criteria)}</span></span></label>`).join('')}
        <h2 class="section-t" style="margin-top:14px">النتيجة</h2>
        <div class="options">${sel.options.map((o) => `<label class="opt"><input type="radio" name="optionId" value="${esc(o.id)}" ${cur.optionId === o.id ? 'checked' : ''}><span>${esc(o.label)}${o.id === sel.ai.optionId ? ' <span class="muted small">(حكم الوكيل)</span>' : ''}</span></label>`).join('')}</div>
        <div class="field"><label for="fac-note">ملاحظة للمتدرب <span class="muted small">(تظهر له مع الحوار)</span></label><textarea id="fac-note" name="note" rows="3">${esc(sel.review?.note ?? '')}</textarea></div>
        ${state.error ? `<div class="outcome bad">${esc(state.error)}</div>` : ''}
        <div class="actions"><button class="btn primary" type="submit">${sel.review ? 'تحديث المراجعة' : 'حفظ المراجعة'}</button>
          <span class="small muted">تعيد المراجعة حساب نقاط المتدرب بالمحرك. إن غيّرت النتيجة مسار أحداثه اللاحقة، ستُرفض مع شرح.</span></div>
      </form>`;
  }
  if (state.filter === 'peer') {
    return `<div class="page-h"><div><h1>لوحة المُيسِّر</h1><p>مراجعات الأقران: المُبلَّغ عنها أولًا. أخفِ ما ليس مهنيًا، فلا يراه الكاتب ولا يُحسب للمراجع.</p></div></div>
    <section class="card"><div class="tabs fac-tabs">${tab('pending', 'غير مراجعة')}${tab('reviewed', 'مراجعة')}${tab('all', 'الكل')}${tab('peer', 'مراجعات الأقران')}</div>
    ${state.loading ? '<div class="empty">جارٍ التحميل…</div>' : peerModerationPage(state)}</section>`;
  }
  return `
  <div class="page-h"><div><h1>لوحة المُيسِّر</h1><p>راجع حكم الوكيل على حوارات المتدربين وصحّحه. حكمك هو المرجع لمعايرة النموذج.</p></div>
    ${cal?.reviewed ? '<button class="btn" data-act="fac-export">تنزيل مجموعة المقارنة (JSON)</button>' : ''}</div>
  <div class="grid g-4">${calCards}</div>
  <div class="inbox-layout" style="margin-top:16px">
    <section class="card inbox-list"><div class="tabs fac-tabs">${tab('pending', 'غير مراجعة')}${tab('reviewed', 'مراجعة')}${tab('all', 'الكل')}${tab('peer', 'مراجعات الأقران')}</div>
      ${state.loading ? '<div class="empty">جارٍ التحميل…</div>' : list.length ? `<div class="items">${list.map(row).join('')}</div>` : '<div class="empty"><b>لا شيء هنا</b></div>'}</section>
    <section class="card detail">${state.loading ? '' : detail}</section>
  </div>`;
}

// ——— الجلسات الحية ———

const STATUS_LIVE = { scheduled: 'مجدولة', live: 'جارية الآن', closed: 'انتهت' };
const ROLE_LABEL = (r, roles) => (r === 'presenter' ? 'المقدّم' : r === 'facilitator' ? 'المُيسِّر' : `دور ${roles?.find((x) => x.speaker === r)?.character ?? r}`);

export function livePage(user, state) {
  const sessions = state.sessions ?? [];
  const fac = user?.role === 'facilitator';
  const meetings = state.meetings ?? [];
  const sel = meetings.find((m) => m.id === state.createEvent) ?? meetings[0];
  return `
  <div class="page-h"><div><h1>الجلسات الحية</h1><p>اجتماعات يعرض فيها متدرب، ويلعب زملاؤه أدوار الحاضرين ببطاقات أدوار، ويحكم فيها المُيسِّر. لعب الأدوار يُحسب في جدارة "التعاون ودعم الزملاء"، ولا يؤثر على نقاط أحد.</p></div></div>
  <div class="grid g-main">
    <section class="card">
      <h2>جلساتي</h2>
      ${state.loading ? '<div class="empty">جارٍ التحميل…</div>' : sessions.length ? `<div class="items">${sessions.map((s) => `<a class="item" href="#/live/${esc(s.id)}">
        <span class="ico">${icon('meeting')}</span>
        <span><div class="tt">${esc(s.title)}</div><div class="meta"><span>المقدّم: ${esc(s.presenter)}</span><span class="pill ${s.status === 'live' ? 'p-critical' : s.status === 'closed' ? 's-done' : 't-pill'}">${STATUS_LIVE[s.status]}</span><span class="pill t-pill">${esc(ROLE_LABEL(s.myRole, s.roles))}</span></div></span>
        <span class="due">${esc(new Date(s.scheduledAt).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }))}</span></a>`).join('')}</div>`
        : '<div class="empty"><b>لا توجد جلسات</b>سيدعوك المُيسِّر إلى جلسة بدور محدد، أو لتكون المقدّم.</div>'}
    </section>
    ${fac && sel ? `<section class="card">
      <h2>جلسة جديدة</h2>
      <form data-form="live-create" class="grid" style="gap:10px">
        <div class="field"><label for="lc-ev">الاجتماع</label><select id="lc-ev" name="eventId" data-act-change="live-event">${meetings.map((m) => `<option value="${esc(m.id)}" ${m.id === sel.id ? 'selected' : ''}>${esc(m.title)} (اليوم ${m.day})</option>`).join('')}</select></div>
        <div class="field"><label for="lc-pr">بريد المتدرب المقدّم</label><input id="lc-pr" name="presenterEmail" type="email" required dir="ltr"></div>
        ${sel.participants.map((p) => `<div class="field"><label>${esc(p.name)} <span class="muted small">(${esc(p.title)})</span></label><input name="role:${esc(p.id)}" type="email" dir="ltr" placeholder="بريد لاعب الدور، أو اتركه فأؤديه أنا"></div>`).join('')}
        <div class="field"><label for="lc-at">الموعد</label><input id="lc-at" name="scheduledAt" type="datetime-local" required dir="ltr"></div>
        ${state.error ? `<div class="outcome bad">${esc(state.error)}</div>` : ''}
        <div class="actions"><button class="btn primary" type="submit">إنشاء الجلسة</button></div>
      </form></section>` : ''}
  </div>`;
}

export function liveMessages(world, s) {
  const people = world.company.people;
  const label = (m) => {
    if (m.as === 'trainee') return `${s.presenter.name} (المقدّم)`;
    if (m.as === 'facilitator') return 'المُيسِّر';
    const role = s.roles.find((r) => r.speaker === m.as);
    return `${people.find((p) => p.id === m.as)?.name ?? m.as}${role && m.by !== 'system' ? ` · ${role.player}` : ''}`;
  };
  return s.messages.map((m) => `<div class="bubble ${m.as === 'trainee' ? 'me' : ''} ${m.as === 'facilitator' ? 'narr' : ''}"><div><div class="who">${esc(label(m))}</div><div class="said">${esc(m.text)}</div></div></div>`).join('')
    || '<div class="empty" style="padding:24px">لم تبدأ الجلسة بعد.</div>';
}

export function liveRoom(world, s, ui = {}) {
  const c = s.card;
  const isFac = s.myRole === 'facilitator';
  const e = world.scenario.events.find((x) => x.id === s.eventId);
  const people = world.company.people;
  let cardHtml = '';
  if (c.kind === 'role') {
    cardHtml = `<h2>${esc(c.title)}</h2><p class="small">${esc(c.persona ?? '')}</p>
      ${c.chair ? `<p class="small"><span class="pill p-normal">أنت رئيس الاجتماع</span>${c.concerns.length ? '' : ' أدِر النقاش: اطلب من المقدّم قرارًا واضحًا ورقمًا، وأعطِ الكلمة لأصحاب الاعتراضات، ثم اختم.'}</p>` : ''}
      ${c.concerns.map((x) => `<div class="outcome info" style="margin:8px 0"><b>اعتراضك:</b> ${esc(x.label)}<br><span class="small"><b>تقتنع فقط إذا:</b> ${esc(x.convinceWhen)}</span><br><span class="small muted">إن اقتنعت، قل شيئًا مثل: «${esc(x.ifConvinced)}». وإن لم تقتنع: «${esc(x.ifNot)}»</span></div>`).join('')}
      <details class="small"><summary>ما تعرفه عن الموقف</summary><p>${esc(c.facts)}</p></details>
      ${c.opening.length ? `<p class="small muted">افتتاحك المقترح: «${esc(c.opening[0])}»</p>` : ''}`;
  } else if (c.kind === 'presenter') {
    cardHtml = `<h2>${esc(c.title)}</h2><p class="small">${esc(c.brief)}</p><p class="small muted">${esc(c.tips)}</p>
      <p class="small">المُيسِّر هو من يحكم في النهاية، وتصلك النتيجة لتعتمدها في محاكاتك.</p>`;
  } else {
    cardHtml = `<h2>${esc(c.title)}</h2><p class="small">${esc(c.brief)}</p>
      <p class="small"><b>الأدوار غير المسندة تؤديها أنت</b> باختيار "أتكلم بصفة".</p>`;
  }
  const roster = s.roles.map((r) => `<li><b>${esc(r.character)}</b> · ${esc(r.player)}</li>`).join('');
  const speakAs = isFac ? `<select name="as" aria-label="أتكلم بصفة"><option value="facilitator">المُيسِّر (تعليق)</option>${s.roles.map((r) => `<option value="${esc(r.speaker)}">${esc(r.character)}</option>`).join('')}</select>` : '';
  const closeForm = isFac && s.status !== 'closed' ? `
    <form data-form="live-close" data-id="${esc(s.id)}" class="card" style="margin-top:12px">
      <h2>ختام الجلسة وحكمك</h2>
      ${e.dialogue.concerns.map((x) => `<label class="consent"><input type="checkbox" name="addressed" value="${esc(x.id)}"><span><b>${esc(people.find((p) => p.id === x.owner)?.name)} — ${esc(x.label)}</b><br><span class="small muted">${esc(x.criteria)}</span></span></label>`).join('')}
      <div class="options">${e.options.map((o) => `<label class="opt"><input type="radio" name="optionId" value="${esc(o.id)}" required><span>${esc(o.label)}</span></label>`).join('')}</div>
      ${s.roles.filter((r) => !r.byFacilitator).map((r) => `<div class="field"><label>تقييم أداء ${esc(r.player)} لدور ${esc(r.character)}</label><select name="rating:${esc(r.speaker)}"><option value="">—</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n} من 5</option>`).join('')}</select></div>`).join('')}
      <div class="field"><label>ملاحظة للمقدّم</label><textarea name="note" rows="2"></textarea></div>
      <div class="actions"><button class="btn primary" type="submit">إنهاء الجلسة واعتماد الحكم</button></div>
    </form>` : '';
  const result = s.result ? `<div class="outcome good" style="margin-bottom:14px;position:relative;z-index:1"><b>حكم المُيسِّر:</b> ${esc(e.options.find((o) => o.id === s.result.optionId)?.label ?? '')} · ${s.result.addressed.length} من ${e.dialogue.concerns.length} اعتراضات مجابة${s.result.note ? `<br><span class="small">${esc(s.result.note)}</span>` : ''}
    ${s.myRole === 'presenter' ? '<div class="actions"><a class="btn primary" href="#/inbox">اعتمد النتيجة من بند الاجتماع في مهامك</a></div>' : ''}</div>` : '';
  return `
  <div class="page-h"><div><a href="#/live" class="small" style="text-decoration:none">→ الجلسات الحية</a><h1>${esc(s.title)}</h1>
    <p>المقدّم: ${esc(s.presenter.name)} · <span class="pill ${s.status === 'live' ? 'p-critical' : s.status === 'closed' ? 's-done' : 't-pill'}">${STATUS_LIVE[s.status]}</span> · دورك: ${esc(ROLE_LABEL(s.myRole, s.roles))}</p></div>
    ${isFac && s.status === 'scheduled' ? `<button class="btn teal" data-act="live-start" data-id="${esc(s.id)}">بدء الجلسة</button>` : ''}</div>
  <div class="grid g-main">
    <section class="card detail">
      ${result}
      <div class="minutes chat-thread" data-live-msgs>${liveMessages(world, s)}</div>
      ${s.status !== 'closed' ? `<form data-form="live-say" data-id="${esc(s.id)}" class="live-form">
        <div class="field"><textarea id="live-msg" name="text" rows="3" maxlength="1500" data-draft="live:${esc(s.id)}" placeholder="${s.myRole === 'presenter' ? 'تحدث إلى الحاضرين…' : 'تكلّم بلسان دورك…'}">${esc(ui.drafts?.[`live:${s.id}`] ?? '')}</textarea></div>
        <div class="actions">${speakAs}<button class="btn primary" type="submit">إرسال</button><span class="small muted">تتحدث الصفحة تلقائيًا كل ثانيتين.</span></div>
      </form>` : ''}
    </section>
    <div>
      <section class="card">${cardHtml}<h2 style="margin-top:14px">الأدوار</h2><ul class="small" style="padding-inline-start:18px">${roster}<li><b>المقدّم</b> · ${esc(s.presenter.name)}</li></ul></section>
      ${closeForm}
    </div>
  </div>`;
}

// ——— التعاون ودعم الزملاء ———

function collabCard(c) {
  if (!c) return '';
  const s = c.summary;
  return `<section class="card" style="margin-top:16px"><h2>التعاون ودعم الزملاء</h2>
    <p class="small muted" style="margin-top:0">دليل منفصل عن النقاط: كيف ساعدت زملاءك في التدريب. يظهر في سجلك الموثّق كما هو.</p>
    <div class="grid g-4">
      <div class="kpi"><div class="k-l">أدوار في جلسات حية</div><div class="k-v"><span class="num">${s.rolesPlayed}</span></div></div>
      <div class="kpi"><div class="k-l">متوسط تقييم المُيسِّر لأدوارك</div><div class="k-v"><span class="num">${s.avgRoleRating ?? '—'}</span>${s.avgRoleRating ? '<span class="muted small"> من 5</span>' : ''}</div></div>
      <div class="kpi"><div class="k-l">مستندات راجعتها</div><div class="k-v"><span class="num">${s.reviewsGiven}</span></div></div>
      <div class="kpi"><div class="k-l">وجدها أصحابها مفيدة</div><div class="k-v"><span class="num">${s.reviewsHelpful}</span></div></div>
    </div>
    ${!s.rolesPlayed && !s.reviewsGiven ? '<p class="small" style="margin-bottom:0">ابدأ من <a href="#/peer">مراجعة الأقران</a>: راجع مستند زميل في 10 دقائق.</p>' : ''}</section>`;
}

// ——— مراجعة الأقران ———

const LEVEL = { yes: 'موجود وواضح', partly: 'موجود جزئيًا', no: 'غير موجود' };
const LEVEL_PILL = { yes: 's-done', partly: 'p-high', no: 'p-critical' };

export function peerPage(user, state) {
  const tab = (id, label) => `<button class="${state.tab === id ? 'on' : ''}" data-act="peer-tab" data-tab="${id}">${label}</button>`;
  let body = '';
  if (state.loading) body = '<div class="empty">جارٍ التحميل…</div>';
  else if (state.tab === 'received') {
    const list = state.received ?? [];
    body = list.length ? list.map((r) => `<article class="peer-rev">
        <div class="chips"><span class="pill t-pill">${esc(r.title)}</span><span class="pill t-pill">زميل متدرب</span><span class="pill t-pill">تقييم عام ${r.overall} من 5</span></div>
        <div class="peer-secs">${r.sections.map((x) => `<span class="pill ${LEVEL_PILL[x.level]}">${esc(x.label)}: ${LEVEL[x.level]}</span>`).join('')}</div>
        <p><b>نقطة قوة:</b> ${esc(r.strengths)}</p><p><b>اقتراح تحسين:</b> ${esc(r.improve)}</p>
        <div class="actions">${r.helpful === null
          ? `<span class="small">هل كانت مفيدة؟</span><button class="btn" data-act="peer-helpful" data-id="${esc(r.id)}" data-v="1">نعم</button><button class="btn ghost" data-act="peer-helpful" data-id="${esc(r.id)}" data-v="0">لا</button>`
          : `<span class="small muted">${r.helpful ? 'قيّمتها مفيدة' : 'قيّمتها غير مفيدة'}</span>`}
          ${r.reported ? '<span class="small muted">أُبلغ المُيسِّر</span>' : `<button class="btn ghost" data-act="peer-report" data-id="${esc(r.id)}">إبلاغ المُيسِّر</button>`}</div>
      </article>`).join('')
      : `<div class="empty"><b>لا توجد مراجعات لمستنداتك بعد</b>${user.consents?.peerReview ? 'تصلك بعد أن يراجعها زملاؤك.' : 'فعّل "عرض مستنداتي على متدربين آخرين" من <a href="#/account">حسابي</a> لتصلك مراجعاتهم.'}</div>`;
  } else {
    const a = (state.queue ?? [])[0];
    body = !a ? '<div class="empty"><b>لا توجد مستندات تنتظر المراجعة الآن</b>تظهر عندما يسلّم زملاؤك مستنداتهم ويوافقون على مراجعتها. الأولوية لمهام سلّمتها أنت.</div>' : `
      <div class="chips"><span class="pill t-pill">${esc(a.title)}</span><span class="pill t-pill">كاتبه زميل متدرب (دون اسم)</span><span class="pill t-pill"><span class="num">${a.words}</span> كلمة</span>${state.queue.length > 1 ? `<span class="pill t-pill">ينتظرك ${state.queue.length - 1} آخر</span>` : ''}</div>
      <details class="small" style="margin:8px 0"><summary>ما طُلب في المهمة</summary><p>${esc(a.brief)}</p></details>
      <div class="peer-doc">${esc(a.text)}</div>
      <form data-form="peer-review" data-id="${esc(a.id)}">
        <h2 class="section-t">هل يغطي المستند كل قسم مطلوب؟</h2>
        ${a.sections.map((x) => `<div class="peer-row"><span>${esc(x.label)}</span><span class="seg">${Object.entries(LEVEL).map(([v, l]) => `<label><input type="radio" name="sec:${esc(x.id)}" value="${v}" required><span>${l}</span></label>`).join('')}</span></div>`).join('')}
        <div class="field"><label for="pr-s">نقطة قوة واحدة على الأقل</label><textarea id="pr-s" name="strengths" rows="2" maxlength="1000" placeholder="ما الذي أقنعك؟ اقتبس جملة إن أمكن."></textarea></div>
        <div class="field"><label for="pr-i">اقتراح تحسين محدد</label><textarea id="pr-i" name="improve" rows="3" maxlength="1500" placeholder="ما الذي ينقص، وكيف يُصلح؟ مثال: أضف مؤشر نجاح بموعد."></textarea></div>
        <div class="field"><label>تقييمك العام</label><span class="seg">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="overall" value="${n}" required><span>${n}</span></label>`).join('')}</span></div>
        ${state.error ? `<div class="outcome bad">${esc(state.error)}</div>` : ''}
        <div class="actions"><button class="btn primary" type="submit">إرسال المراجعة</button><span class="small muted">مراجعتك لا تغيّر نقاط زميلك. تُحسب لك في "التعاون ودعم الزملاء" إن وجدها مفيدة.</span></div>
      </form>`;
  }
  return `
  <div class="page-h"><div><h1>مراجعة الأقران</h1><p>راجع مستندات زملائك بمعايير المهمة نفسها، واقرأ ما كتبوه عن مستنداتك. دون أسماء في الاتجاهين.</p></div></div>
  <section class="card"><div class="tabs fac-tabs">${tab('review', 'راجع مستند زميل')}${tab('received', 'مراجعات مستنداتي')}</div>${body}</section>`;
}

export function peerModerationPage(state) {
  const list = state.peer ?? [];
  return list.length ? list.map((r) => `<article class="peer-rev ${r.hidden ? 'muted' : ''}">
      <div class="chips"><span class="pill t-pill">${esc(r.title)}</span><span class="pill t-pill">المراجع: ${esc(r.reviewer)}</span><span class="pill t-pill">الكاتب: ${esc(r.author)}</span><span class="pill t-pill">${r.overall} من 5</span>
        ${r.reported ? '<span class="pill p-critical">أبلغ عنها الكاتب</span>' : ''}${r.helpful === true ? '<span class="pill s-done">مفيدة</span>' : ''}${r.hidden ? '<span class="pill p-high">مخفية</span>' : ''}</div>
      <p><b>نقطة قوة:</b> ${esc(r.strengths)}</p><p><b>اقتراح تحسين:</b> ${esc(r.improve)}</p>
      ${r.hidden && r.hiddenReason ? `<p class="small muted">سبب الإخفاء: ${esc(r.hiddenReason)}</p>` : ''}
      <div class="actions">${r.hidden ? `<button class="btn" data-act="peer-moderate" data-id="${esc(r.id)}" data-hide="0">إظهار</button>` : `<button class="btn ghost" data-act="peer-moderate" data-id="${esc(r.id)}" data-hide="1">إخفاء</button>`}</div>
    </article>`).join('') : '<div class="empty"><b>لا توجد مراجعات أقران بعد</b></div>';
}

// ——— تحداني على نفس الشركة ———

export const challengeUrl = (code) => `${location.origin}/c/${code}`;

function shareText(c) {
  return c.owner.finished
    ? `أنهيت شهري مديرًا للمنتجات في ${c.company} بـ${c.owner.points} نقطة من 1000. نفس الشركة ونفس الأحداث بالضبط، تقدر تتفوق علي؟`
    : `${c.owner.points} نقطة بعد ${c.owner.days} أيام عمل كمدير منتجات في ${c.company}. جرّب نفس الشركة بنفس الأحداث، تقدر تتفوق علي؟`;
}

function shareButtons(c) {
  const url = challengeUrl(c.code);
  const text = shareText(c);
  const enc = encodeURIComponent;
  return `<div class="share-row">
    <button class="btn primary" data-act="share-challenge" data-code="${esc(c.code)}">مشاركة</button>
    <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(`${text}\n${url}`)}">واتساب</a>
    <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}">X</a>
    <a class="btn" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}">لينكدإن</a>
    <button class="btn ghost" data-act="copy-challenge" data-code="${esc(c.code)}">نسخ الرابط</button>
  </div>
  <p class="small muted" dir="ltr" style="text-align:right;margin:6px 0 0">${esc(url)}</p>`;
}

function boardTable(c) {
  return `<table class="board"><thead><tr><th>#</th><th>المتدرب</th><th>النقاط</th><th>الأيام</th></tr></thead><tbody>
    ${c.board.map((b, i) => `<tr class="${b.you ? 'you' : ''}"><td class="num">${i + 1}</td><td>${esc(b.name)}${b.owner ? ' <span class="pill t-pill">صاحب التحدي</span>' : ''}${b.you ? ' <span class="pill s-done">أنت</span>' : ''}</td>
      <td class="num"><b>${b.points}</b></td><td class="num">${b.finished ? '✓ 30' : `${b.days} من ${c.lengthDays}`}</td></tr>`).join('')}
  </tbody></table>`;
}

/** بطاقة في "تطورك المهني": إنشاء رابط تحدٍّ ومشاركته، أو موقفك في التحدي الذي انضممت إليه. */
export function challengeCard(session, user, ui = {}) {
  if (session.challenge) {
    const c = ui.joinedChallenge;
    if (!c) return '';
    const me = c.board.find((b) => b.you);
    const owner = c.owner;
    const ahead = me && me.points > owner.points;
    return `<section class="card challenge-card" style="margin-top:16px">
      <h2>تحدي ${esc(owner.name)}</h2>
      <p style="margin-top:0">${me ? `أنت <b class="num">${me.points}</b> مقابل <b class="num">${owner.points}</b> لـ${esc(owner.name)}. ${ahead ? 'أنت في الصدارة الآن 👏' : 'ما زالت أمامك فرصة.'}` : 'سجّل الدخول ليظهر اسمك في لوحة التحدي.'}</p>
      <a class="btn" href="#/challenge/${esc(c.code)}">لوحة التحدي (${c.participants + 1} متدربين)</a></section>`;
  }
  if (!session.log.some((a) => a.t === 'endDay')) return '';
  const c = ui.myChallenge;
  return `<section class="card challenge-card" style="margin-top:16px">
    <h2>تحدَّ أصدقاءك على نفس الشركة</h2>
    <p class="small" style="margin-top:0">رابط يفتح لصديقك <b>العالم نفسه بالضبط</b>: نفس الشركة ونفس الأحداث ونفس البداية. ثم تظهر نتائجكم جنبًا إلى جنب. لا يظهر إلا اسمك الأول ونقاطك.</p>
    ${!user ? '<button class="btn primary" data-act="open-auth" data-mode="register">أنشئ حسابًا لتحصل على رابط تحدٍّ</button>'
      : c ? `${shareButtons(c)}<div class="actions" style="margin-top:8px"><a class="btn ghost" href="#/challenge/${esc(c.code)}">اللوحة (${c.participants} انضموا)</a><button class="btn ghost" data-act="revoke-challenge" data-code="${esc(c.code)}">إلغاء الرابط</button></div>`
      : '<button class="btn primary" data-act="create-challenge">أنشئ رابط التحدي</button>'}
  </section>`;
}

/** صفحة التحدي العامة: تعمل دون حساب ودون جلسة. */
export function challengePage(state, { session, user } = {}) {
  const frame = (inner) => `<div class="verify-wrap"><div class="brand verify-brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>${inner}
    <p class="disclaimer verify-note">NOVA TECH شركة افتراضية. محاكي بيئة تدريب ومحاكاة لوظائف حقيقية في السوق السعودي.</p></div>`;
  if (state.loading) return frame('<section class="card"><div class="empty">جارٍ التحميل…</div></section>');
  if (state.error) return frame(`<section class="card"><div class="empty"><b>لا يوجد تحدٍّ بهذا الرابط</b>${esc(state.error)}</div><div class="actions"><a class="btn primary" href="#/desk">ابدأ شهرك الخاص</a></div></section>`);
  const c = state.challenge;
  const inThis = session?.challenge === c.code || (c.mine && session?.seed === c.seed);
  const hasOther = session && !inThis && session.log.length > 0;
  const action = inThis
    ? '<a class="btn primary" href="#/desk">أكمل شهرك في التحدي</a>'
    : `<button class="btn primary" data-act="accept-challenge" data-code="${esc(c.code)}">اقبل التحدي وابدأ</button>
       ${hasOther ? `<p class="small" style="color:var(--red,#c0392b)">سيبدأ شهر جديد ويحلّ محل تقدمك الحالي (اليوم ${session.sim.day}). سجلاتك الموثّقة الصادرة لا تتأثر.</p>` : ''}`;
  return frame(`
  <section class="card challenge-hero">
    <div class="muted small">تحدٍّ في محاكي</div>
    <h1>تحدٍّ من ${esc(c.owner.name)}: <span class="num">${c.owner.points}</span> نقطة ${c.owner.finished ? 'بعد شهر كامل' : `بعد ${c.owner.days} أيام عمل`}</h1>
    <p>شهر كامل في دور <b>${esc(c.role)}</b> في <b>${esc(c.company)}</b>، شركة SaaS سعودية افتراضية: قرارات لها عواقب، واجتماعات مع زملاء يعترضون، ومستندات تُقيَّم. <b>ستلعب العالم نفسه بالضبط</b>، فالمقارنة عادلة.</p>
    <div class="actions">${action}</div>
    ${!user && !inThis ? '<p class="small muted">تبدأ اليوم الأول ضيفًا دون تسجيل. لتظهر في اللوحة، أنشئ حسابًا بعده.</p>' : ''}
    ${user && !inThis ? '<p class="small muted">بانضمامك يظهر اسمك الأول ونقاطك في لوحة هذا التحدي فقط.</p>' : ''}
  </section>
  <section class="card" style="margin-top:14px"><h2>اللوحة</h2>${boardTable(c)}
    ${c.participants === 0 ? '<p class="small muted">لم ينضم أحد بعد. كن الأول.</p>' : ''}
    ${c.mine ? shareButtons(c) : ''}</section>`);
}

// ——— ملف الأعمال الموثّق ———

export const portfolioUrl = (slug) => `${location.origin}/p/${slug}`;

/** منحنيان: الإيراد الشهري بقرارات المتدرب مقابل لو لم يفعل شيئًا (العالم نفسه). */
export function versusChart(you, base, { w = 560, h = 170 } = {}) {
  const all = [...you, ...base];
  const min = Math.min(...all) * 0.98; const max = Math.max(...all) * 1.02;
  const x = (i, n) => (n <= 1 ? 0 : (i / (n - 1)) * (w - 8) + 4);
  const y = (v) => h - 6 - ((v - min) / (max - min || 1)) * (h - 12);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="versus" role="img" aria-label="الإيراد الشهري: بالقرارات المتخذة مقابل دون قرارات">
    <path d="${path(base)}" fill="none" stroke="#9aa6bf" stroke-width="2.5" stroke-dasharray="6 5"/>
    <path d="${path(you)}" fill="none" stroke="#00C2D1" stroke-width="3.5" stroke-linecap="round"/>
  </svg>
  <div class="legend small"><span><i style="background:#00C2D1"></i>بالقرارات المتخذة</span><span><i style="background:#9aa6bf"></i>دون أي قرار</span></div>`;
}

function shareRow(url, text, extra = '') {
  const enc = encodeURIComponent;
  return `<div class="share-row">
    <a class="btn" target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}">لينكدإن</a>
    <a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${enc(`${text}\n${url}`)}">واتساب</a>
    <a class="btn" target="_blank" rel="noopener" href="https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}">X</a>
    <button class="btn ghost" data-act="copy-url" data-url="${esc(url)}">نسخ الرابط</button>${extra}
  </div><p class="small muted" dir="ltr" style="text-align:right;margin:6px 0 0">${esc(url)}</p>`;
}

/** محرر ملف الأعمال داخل بيئة العمل. */
export function portfolioEditor(state) {
  if (state.loading) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  if (state.error) return `<section class="card"><div class="empty"><b>لا يمكن بناء ملف الأعمال الآن</b>${esc(state.error)}</div></section>`;
  const d = state.data;
  const pf = d.portfolio;
  const sel = state.draft;
  const group = (key, title, hint, row) => {
    const list = d.candidates[key];
    const n = sel.selections[key].length;
    return `<section class="card pf-group"><h2>${title} <span class="muted small">(${n} من ${d.limits[key]})</span></h2><p class="small muted" style="margin-top:0">${hint}</p>
      ${list.length ? list.map((x) => {
        const on = sel.selections[key].includes(x.id);
        return `<label class="pf-pick ${on ? 'on' : ''}"><input type="checkbox" data-act-change="pf-pick" data-key="${key}" value="${esc(x.id)}" ${on ? 'checked' : ''} ${!on && n >= d.limits[key] ? 'disabled' : ''}><span>${row(x)}</span></label>`;
      }).join('') : '<div class="empty" style="padding:14px">لا يوجد بعد.</div>'}</section>`;
  };
  return `
  <div class="page-h"><div><h1>ملف أعمالك الموثّق</h1><p>اختر ما يُعرض من شهرك. المحتوى نفسه يُولَّد من سجل أفعالك على الخادم، فلا يمكن تعديله أو تجميله، وهذا ما يجعله موثوقًا لصاحب العمل.</p></div></div>
  <div class="grid g-main">
    <div>
      ${group('deliverables', 'المستندات', 'تظهر كاملة كما سلّمتها، مع الأقسام التي غطّتها.', (x) => `<b>${esc(x.title)}</b> <span class="pill t-pill">اليوم ${x.day}</span> <span class="pill ${x.score >= 70 ? 's-done' : 'p-high'}">${x.score}%</span><br><span class="small muted">${esc(x.excerpt)}…</span>`)}
      ${group('decisions', 'القرارات', 'القرار الذي اتخذته ومبررك كما كتبته.', (x) => `<b>${esc(x.title)}</b> <span class="pill t-pill">اليوم ${x.day}</span>${x.dialogue ? ` <span class="pill t-pill">حوار · ${x.addressed} من ${x.concerns} اعتراضات</span>` : ''}<br><span class="small">${esc(x.choice)}</span>${x.rationale ? `<br><span class="small muted">«${esc(x.rationale.slice(0, 160))}»</span>` : ''}`)}
      ${group('quotes', 'من كلامك في الاجتماعات', 'جُمل قلتها أنت فقط، لا كلام زملائك.', (x) => `<span>«${esc(x.text)}»</span><br><span class="small muted">${esc(x.title)} · اليوم ${x.day}</span>`)}
    </div>
    <div>
      <form class="card" data-form="portfolio">
        <h2>الإعدادات</h2>
        <div class="field"><label for="pf-h">سطر تعريفي <span class="muted small">(اختياري، 140 حرفًا)</span></label><input id="pf-h" name="headline" maxlength="140" value="${esc(sel.headline)}" placeholder="مثال: مدير منتجات يبني القرار على البيانات"></div>
        <div class="field"><label>الاسم الظاهر</label>
          <label class="consent"><input type="radio" name="displayName" value="first" ${sel.displayName !== 'full' ? 'checked' : ''}><span>الاسم الأول فقط (${esc(d.firstName)})</span></label>
          <label class="consent"><input type="radio" name="displayName" value="full" ${sel.displayName === 'full' ? 'checked' : ''}><span>الاسم الكامل (${esc(d.fullName)}): أنسب لجهات التوظيف</span></label></div>
        <label class="consent"><input type="checkbox" name="published" ${sel.published ? 'checked' : ''}><span><b>منشور</b>: يراه كل من لديه الرابط. لا يظهر بريدك ولا بيانات تواصلك.</span></label>
        <div class="actions"><button class="btn primary" type="submit">${pf ? 'حفظ' : 'إنشاء الملف'}</button>
          ${pf?.published ? `<a class="btn" href="#/portfolio/${esc(pf.slug)}">معاينة</a>` : ''}</div>
      </form>
      ${pf?.published ? `<section class="card" style="margin-top:12px"><h2>شارك ملفك</h2>
        ${shareRow(portfolioUrl(pf.slug), 'هذا ملف أعمالي الموثّق من شهر عمل كمدير منتجات في محاكي: قراراتي ومستنداتي وأثرها على الشركة، كلها موثّقة.')}
        <p class="small muted">أضِف الرابط إلى قسم "مميز" في لينكدإن، أو إلى سيرتك الذاتية.</p>
        <div class="actions"><a class="btn teal" href="#/video">اصنع فيديو من ملفك</a></div></section>` : ''}
      ${pf ? '<section class="card" style="margin-top:12px"><h2>إيقاف الملف</h2><p class="small muted">يحذف الملف ويتوقف الرابط نهائيًا. إن نشرت لاحقًا تحصل على رابط جديد.</p><button class="btn ghost" data-act="pf-delete">حذف الملف وإيقاف الرابط</button></section>' : ''}
    </div>
  </div>`;
}

/** الصفحة العامة لملف الأعمال: تعمل دون حساب. */
export function portfolioPage(state) {
  const frame = (inner) => `<div class="pf-wrap"><div class="brand verify-brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>${inner}
    <p class="disclaimer verify-note">أعمال داخل بيئة محاكاة لشركة افتراضية (NOVA TECH). كل ما في الصفحة يُولَّد من إعادة تشغيل قرارات صاحبها على خادم محاكي، فلا يمكن تعديله يدويًا. ليس شهادة خبرة ولا شهادة تدريب معتمدة.</p></div>`;
  if (state.loading) return frame('<section class="card"><div class="empty">جارٍ التحميل…</div></section>');
  if (state.error) return frame(`<section class="card"><div class="empty"><b>ملف الأعمال غير متاح</b>${esc(state.error)}</div></section>`);
  const p = state.portfolio;
  const pctDelta = (a, b) => `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`;
  return frame(`
  <section class="card pf-hero">
    <div class="cert-top"><span class="pill s-done">✓ موثّق بإعادة التشغيل</span>${p.record ? `<a class="small" href="#/verify/${esc(p.record.code)}">السجل ${esc(p.record.code)}</a>` : ''}</div>
    <h1>${esc(p.name)}</h1>
    ${p.headline ? `<p class="pf-headline">${esc(p.headline)}</p>` : ''}
    <p class="muted">${esc(p.role)} · ${esc(p.company)} · ${p.finished ? `${p.lengthDays} يوم عمل مكتملة` : `${p.days} من ${p.lengthDays} يوم عمل`}${p.occupation ? ` · التصنيف السعودي للمهن ${esc(p.occupation.code)}` : ''}</p>
    <div class="pf-stats">
      <div><b class="num">${p.points}</b><span>نقطة من 1000 · ${esc(p.band)}</span></div>
      <div><b class="num">${p.counts.decisions}</b><span>قرارًا</span></div>
      <div><b class="num">${p.counts.dialogues}</b><span>اجتماعًا ومحادثة</span></div>
      <div><b class="num">${p.counts.deliverables}</b><span>مستندات</span></div>
    </div>
  </section>
  <section class="card"><h2>الأثر على الشركة</h2>
    <p class="small muted" style="margin-top:0">العالم نفسه بالأحداث نفسها، مرة بالقرارات المتخذة ومرة دون أي قرار.</p>
    ${versusChart(p.series.you, p.series.baseline)}
    <div class="pf-stats small-stats">
      <div><b class="num">${pctDelta(p.impact.mrr, p.impact.mrrBaseline)}</b><span>الإيراد الشهري</span></div>
      <div><b class="num">${p.impact.customers - p.impact.customersBaseline >= 0 ? '+' : ''}${p.impact.customers - p.impact.customersBaseline}</b><span>عملاء</span></div>
      <div><b class="num">${p.impact.health - p.impact.healthBaseline >= 0 ? '+' : ''}${p.impact.health - p.impact.healthBaseline}</b><span>رضا العملاء</span></div>
    </div>
    ${p.shipped.length ? `<p class="small"><b>ما أُطلق خلال الشهر:</b> ${p.shipped.map((s) => esc(s.title)).join('، ')}</p>` : ''}
  </section>
  ${p.marketResearch?.confirmed ? `<section class="card"><h2>أبحاث سوق معتمدة</h2><p class="small muted" style="margin-top:0">أسئلة سوق حقيقية أجاب عنها بمصدر، وطابق جوابه الجواب المعتمد من عدة باحثين مستقلين.</p>
    <ul class="feed">${p.marketResearch.items.map((x) => `<li><span class="dot"></span>${esc(x.title)}</li>`).join('')}</ul></section>` : ''}
  ${p.realWork?.count ? `<section class="card"><h2>أعمال واقعية معتمدة</h2><p class="small muted" style="margin-top:0">أعمال حقيقية لجهات حقيقية، راجعها واعتمدها مراجع من الجهة أو مُيسِّر.</p>
    ${p.realWork.items.map((x) => `<article class="pf-item"><h3>${esc(x.title)}</h3><p class="small">${esc(x.org)} · تقييم المراجع <b class="num">${x.rating}</b> من 5</p></article>`).join('')}</section>` : ''}
  <section class="card"><h2>المهارات</h2><div class="grid" style="gap:12px">${p.skills.map((s) => `<div class="barrow"><span>${esc(s.label)}</span><span class="num">${s.score}%</span>${bar(s.score)}</div>`).join('')}</div></section>
  ${p.decisions.length ? `<section class="card"><h2>قرارات مختارة</h2>${p.decisions.map((x) => `<article class="pf-item"><div class="small muted">اليوم ${x.day}${x.dialogue ? ` · حوار أجاب فيه ${x.addressed} من ${x.concerns} اعتراضات` : ''}</div><h3>${esc(x.title)}</h3><p><b>القرار:</b> ${esc(x.choice)}</p>${x.rationale ? `<p class="pf-quote">«${esc(x.rationale)}»</p>` : ''}</article>`).join('')}</section>` : ''}
  ${p.quotes.length ? `<section class="card"><h2>من الاجتماعات</h2>${p.quotes.map((x) => `<blockquote class="pf-quote">«${esc(x.text)}»<footer class="small muted">${esc(x.title)} · اليوم ${x.day}</footer></blockquote>`).join('')}</section>` : ''}
  ${p.deliverables.map((x) => `<section class="card"><h2>${esc(x.title)}</h2><div class="chips"><span class="pill t-pill">اليوم ${x.day}</span><span class="pill t-pill">${x.words} كلمة</span><span class="pill ${x.score >= 70 ? 's-done' : 'p-high'}">التقييم ${x.score}%</span>${x.covered.map((c) => `<span class="pill s-done">✓ ${esc(c)}</span>`).join('')}</div>
    <details><summary>اقرأ المستند كاملًا</summary><div class="peer-doc">${esc(x.text)}</div></details></section>`).join('')}
  <section class="card pf-cta"><h2>جرّب الشهر نفسه</h2><p class="small"> ${p.challenge ? `تحدٍّ مفتوح من ${esc(p.name)}: نفس الشركة ونفس الأحداث بالضبط.` : 'شهر كامل كمدير منتجات في شركة سعودية افتراضية.'}</p>
    <a class="btn primary" href="${p.challenge ? `#/challenge/${esc(p.challenge)}` : '#/desk'}">${p.challenge ? 'اقبل التحدي' : 'ابدأ شهرك'}</a></section>`);
}

function portfolioCard() {
  return `<section class="card" style="margin-top:16px"><h2>ملف أعمالك الموثّق</h2>
    <p class="small" style="margin-top:0">صفحة عامة تختار أنت ما يُعرض فيها: مستنداتك، وقراراتك ومبرراتك، وجملك في الاجتماعات، وأثرك على الشركة. كل ما فيها موثّق بإعادة التشغيل.</p>
    <a class="btn primary" href="#/portfolio">بناء ملف الأعمال</a></section>`;
}

// ——— الفيديو ———

export const progressBar = (v) => bar(v);

export function videoPage(state) {
  if (state.loading) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  if (state.error) return `<section class="card"><div class="empty"><b>انشر ملف أعمالك أولًا</b>${esc(state.error)}</div><div class="actions"><a class="btn primary" href="#/portfolio">ملف الأعمال</a></div></section>`;
  return `
  <div class="page-h"><div><h1>فيديو شهرك</h1><p>فيديو عمودي جاهز لسناب وتيك توك وإنستغرام ولينكدإن، يُبنى من ملف أعمالك المنشور. يُصنع داخل متصفحك، ولا يُرفع إلى أي مكان إلا إذا نشرته أنت.</p></div></div>
  <div class="grid g-main">
    <section class="card video-stage"><canvas id="video-canvas" width="1080" height="1920" aria-label="معاينة الفيديو"></canvas></section>
    <section class="card">
      <h2>المشاهد</h2>
      <ol class="small" style="padding-inline-start:18px;line-height:2">
        <li>30 يومًا في دور مدير منتجات، باسمك وسطرك التعريفي</li>
        <li>أصعب موقف: من القرارات التي اخترتها في ملفك</li>
        <li>جملة قلتها في اجتماع (أو مبرر قرارك)</li>
        <li>منحنى الإيراد بقراراتك مقابل عالم دون قرارات</li>
        <li>عدد القرارات والحوارات والمستندات، وما أطلقته</li>
        <li>نقاطك، ورابط ملفك للتحقق</li>
      </ol>
      <p class="small muted">لتغيير المحتوى، عدّل اختياراتك في <a href="#/portfolio">ملف الأعمال</a>.</p>
      ${state.recording ? `<div class="bar-wrap"><div class="small">جارٍ التسجيل… ${Math.round(state.progress * 100)}%</div>${bar(state.progress * 100)}</div><p class="small muted">يُسجَّل الفيديو في وقته الحقيقي (${state.seconds} ثانية). أبقِ هذه الصفحة مفتوحة.</p>`
        : state.file ? `<div class="outcome good"><b>الفيديو جاهز</b> (${state.file.ext.toUpperCase()}، ${(state.file.blob.size / 1e6).toFixed(1)} م.ب)</div>
          <div class="share-row"><a class="btn primary" href="${state.file.url}" download="mohaki-${esc(state.slug)}.${state.file.ext}">تنزيل الفيديو</a>
          ${state.canShareFile ? '<button class="btn" data-act="video-share">مشاركة</button>' : ''}<button class="btn ghost" data-act="video-record">تسجيل من جديد</button></div>
          ${state.file.ext === 'webm' ? '<p class="small muted">متصفحك سجّل بصيغة WebM. بعض التطبيقات تفضّل MP4: سجّل من Safari أو Chrome حديث، أو حوّله بأي أداة تحويل.</p>' : ''}
          <p class="small muted">اقتراح للنشر: «30 يومًا مدير منتجات في شركة افتراضية. هذه قراراتي وأثرها، وكلها موثّقة» مع رابط ملفك.</p>`
        : `<div class="actions"><button class="btn primary" data-act="video-record">صناعة الفيديو (${state.seconds} ثانية)</button></div>`}
    </section>
  </div>`;
}

// ——— المكتبة والمرفقات ———

export function libraryDocs(session) {
  return (session.world.library?.docs ?? []).filter((d) => session.sim.day >= (d.fromDay ?? 1));
}

function attachmentsBlock(session, item) {
  const docs = (item.attachments ?? []).map((id) => session.world.library?.docs.find((d) => d.id === id)).filter(Boolean);
  if (!docs.length) return '';
  return `<div class="attachments">${docs.map((d) => `<a class="attach ${session.read?.[d.id] ? 'read' : ''}" href="#/library/${esc(d.id)}">
    <span class="attach-ico">📄</span><span><b>${esc(d.title)}</b><span class="small muted"> · ${esc(d.kind)} · ${d.minutes} دقائق قراءة${session.read?.[d.id] ? ' · ✓ قرأته' : ''}</span></span></a>`).join('')}</div>`;
}

export function library(session, docId) {
  const docs = libraryDocs(session);
  const raw = docs.find((d) => d.id === docId);
  const doc = raw?.fromGlossary ? { ...raw, sections: (session.world.library.glossary ?? []).map((t) => ({ h: `${t.term} — ${t.full}`, body: t.ar })) } : raw;
  const locked = (session.world.library?.docs ?? []).filter((d) => session.sim.day < (d.fromDay ?? 1));
  const list = `<section class="card inbox-list"><h2>المستندات</h2><div class="items">${docs.map((d) => `<a class="item ${d.id === docId ? 'on' : ''}" href="#/library/${esc(d.id)}">
      <span class="ico">${icon('book')}</span>
      <span><div class="tt">${esc(d.title)}</div><div class="meta"><span class="pill t-pill">${esc(d.kind)}</span><span>${d.minutes} د</span>${session.read?.[d.id] ? '<span class="pill s-done">مقروء</span>' : '<span class="pill p-normal">جديد</span>'}</div></span><span></span></a>`).join('')}</div>
    ${locked.length ? `<p class="small muted" style="padding:10px 14px">يُفتح ${locked.length} مستندات أخرى مع تقدمك في الأيام القادمة.</p>` : ''}</section>`;
  let detail = '<div class="empty"><b>اختر مستندًا</b>من يقرأ أكثر، يكتشف ما لا يقوله أحد.</div>';
  if (doc) {
    const from = session.person(doc.from);
    const ins = session.sim.insights().find((x) => x.doc === doc.id);
    detail = `<div class="from">${avatar(from)}<div><b>${esc(from.name)}</b><div class="muted small">${esc(from.title)}</div></div></div>
      <div class="chips"><span class="pill t-pill">${esc(doc.kind)}</span><span class="pill t-pill">${doc.minutes} دقائق قراءة</span></div>
      <h1>${esc(doc.title)}</h1><p class="muted">${esc(doc.summary)}</p>
      <article class="doc-body">${doc.sections.map((x) => `<h3>${esc(x.h)}</h3><p>${jg(session, esc(x.body))}</p>`).join('')}</article>
      ${ins ? (ins.reported ? `<div class="outcome good"><b>أبلغت عن هذه الملاحظة.</b> ${esc(ins.result ?? '')}</div>`
        : `<div class="outcome info insight"><b>هل لاحظت شيئًا مهمًا في هذا المستند؟</b><p class="small">من يقرأ بانتباه ويبلّغ صاحب الشأن في الوقت المناسب، يصنع فرقًا.</p>
          <button class="btn teal" data-act="report-insight" data-id="${esc(ins.id)}">${esc(ins.label)}</button></div>`) : ''}`;
  }
  return `<div class="page-h"><div><h1>مكتبة الشركة</h1><p>أدلة وسياسات ودراسات ومحاضر. تُفتح مستندات جديدة مع الأيام. اقرأ حين تنهي مهامك.</p></div></div>
  <div class="inbox-layout">${list}<section class="card detail">${detail}</section></div>`;
}

// ——— ماذا الآن؟ (بعد إنهاء المهام) ———

function whatNow(session) {
  const sim = session.sim;
  const docs = libraryDocs(session).filter((d) => !session.read?.[d.id]);
  const mails = generatedMail(session).filter((m) => !session.opened?.[m.id]);
  const insightsOpen = sim.insights().filter((x) => !x.reported).length;
  const tips = [
    mails.length && `<li><a href="#/inbox?f=all">اقرأ بريدك</a>: ${mails.length} رسائل لم تفتحها (تقارير وتعاميم).</li>`,
    docs.length && `<li><a href="#/library/${esc(docs[0].id)}">اقرأ في المكتبة</a>: ${docs.length} مستندات لم تقرأها بعد، أولها «${esc(docs[0].title)}».</li>`,
    insightsOpen && '<li>في المكتبة ملاحظات قد تهم أحد زملائك. من يقرأ بانتباه ويبلّغ في الوقت المناسب يُحسب له ذلك.</li>',
    '<li><a href="#/team">تحدث مع زميل</a>: اسأل فهد عن الأرقام، أو سلمى عن نصيحة، أو أمل عن العملاء.</li>',
    '<li><a href="#/company">راجع نتائج الشركة</a>: هل تتحرك المؤشرات في الاتجاه الذي تريده؟</li>',
  ].filter(Boolean);
  return `<section class="card what-now" style="margin-top:16px">
    <h2>أنجزت مهام اليوم. ماذا الآن؟</h2>
    <p class="small muted" style="margin-top:0">الموظف المتميز لا ينتظر المهمة التالية. هذه أفكار لبقية يومك:</p>
    <ul>${tips.join('')}</ul>
    <div class="actions"><button class="btn primary" data-act="end-day">إنهاء يوم العمل</button></div>
  </section>`;
}

// ——— الزميل المنفّذ ———

function delegateBlock(session, item, drafts) {
  const spec = item.delegable;
  if (!spec || session.sim.day < (spec.fromDay ?? 1)) return '';
  const who = session.person(spec.to);
  const draft = drafts[`delegate:${item.id}`] ?? '';
  return `<details class="delegate card-lite"><summary>${avatar(who, 'sm')} <b>أو كلّف ${esc(who.name)} بالتنفيذ</b> <span class="small muted">· ينفذ ولا يقرر، ويعود بالنتيجة خلال ${spec.days ?? 2} أيام</span></summary>
    <form data-form="delegate" data-item="${esc(item.id)}">
      <div class="field"><label for="brief">نص التكليف</label>
        <textarea id="brief" name="brief" rows="3" data-draft="delegate:${esc(item.id)}" placeholder="ما الهدف؟ ما المطلوب بالتحديد؟ ما شكل المخرج؟ ومتى تريده؟">${esc(draft)}</textarea>
        <div class="hint"><span>التكليف الواضح يعود بنتيجة جيدة. والعام يعود ناقصًا.</span><span class="num" data-wc>${words(draft)} كلمة</span></div></div>
      <div class="actions"><button class="btn teal" type="submit">إرسال التكليف</button></div>
    </form></details>`;
}

// ——— الزميل الحقيقي ———

function realPartnerCard(session, ui) {
  const user = session.user;
  const st = ui.pairs;
  const active = st?.pairs?.find((p) => p.active);
  let body;
  if (!user) body = '<p class="small" style="margin:0">سجّل الدخول لتعمل مع متدرب حقيقي.</p><div class="actions"><button class="btn primary" data-act="open-auth" data-mode="register">أنشئ حسابًا</button></div>';
  else if (!st) body = '<p class="small muted" style="margin:0">جارٍ التحميل…</p>';
  else if (active) body = `<p style="margin:0">زميلك الآن: <b>${esc(active.partner)}</b> (في يوم العمل ${active.partnerDay}). يستمر العمل المشترك حتى ${esc(new Date(active.endsAt).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long' }))}.</p>
      <div class="actions"><a class="btn primary" href="#/pair/${esc(active.id)}">افتح المحادثة${active.messages.length ? ` (${active.messages.length})` : ''}</a></div>`;
  else if (st.waiting) body = '<p style="margin:0">نبحث لك عن زميل… سنقرنك بأول متدرب يطلب زميلًا.</p><div class="actions"><button class="btn ghost" data-act="pair-cancel">إلغاء الطلب</button></div>';
  else body = `<p style="margin:0">اعمل أسبوعًا مع متدرب حقيقي في الشركة نفسها: تتناقشان وتتبادلان الأفكار. القرار في محاكاتك لك وحدك.</p>
      ${!user.emailVerified ? '<p class="small muted">أكّد بريدك أولًا.</p>' : '<div class="actions"><button class="btn primary" data-act="pair-request">ابحث لي عن زميل</button></div>'}
      ${st.pairs?.length ? `<p class="small muted">زملاء سابقون: ${st.pairs.map((p) => `<a href="#/pair/${esc(p.id)}">${esc(p.partner)}</a>`).join('، ')}</p>` : ''}`;
  return `<section class="card real-partner"><div class="rp-h">${icon('team')}<h2>زميل حقيقي</h2><span class="pill t-pill">متدرب مثلك</span></div>${body}
    <p class="small muted" style="margin:8px 0 0">المحادثة محفوظة السجل للطرفين. لا تُستخدم لتحسين النماذج إلا إذا وافق الطرفان من صفحة "حسابي".</p></section>`;
}

export function pairChat(pair) {
  if (!pair) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  return `<div class="page-h"><div><a href="#/team" class="small" style="text-decoration:none">→ فريقي</a><h1>محادثتك مع ${esc(pair.partner)}</h1>
    <p>${pair.active ? `متدرب حقيقي في يوم العمل ${pair.partnerDay}. حتى ${esc(new Date(pair.endsAt).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long' }))}.` : 'انتهت مدة العمل المشترك. السجل محفوظ للاطلاع.'}</p></div></div>
  <section class="card detail">
    <div class="minutes chat-thread" data-pair-msgs>${pairMessages(pair)}</div>
    ${pair.active ? `<form data-form="pair-say" data-id="${esc(pair.id)}" class="live-form">
      <div class="field"><textarea id="pair-msg" name="text" rows="3" maxlength="1500" placeholder="اسأل زميلك، أو شاركه فكرة. القرار في محاكاة كل منكما لصاحبها."></textarea></div>
      <div class="actions"><button class="btn primary" type="submit">إرسال</button><span class="small muted">المحادثة محفوظة السجل، وتتحدث تلقائيًا.</span></div></form>` : ''}
  </section>`;
}

export function pairMessages(pair) {
  return pair.messages.map((m) => `<div class="bubble ${m.mine ? 'me' : ''}"><div><div class="who">${m.mine ? 'أنت' : esc(pair.partner)}</div><div class="said">${esc(m.text)}</div></div></div>`).join('')
    || '<div class="empty" style="padding:24px">ابدأ المحادثة: عرّف بنفسك، وأين وصلت في شهرك.</div>';
}

// ——— دوري الفرق ———

const dt = (iso) => new Date(iso).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

export function leaguesPage(user, state) {
  const fac = user?.role === 'facilitator';
  const list = state.leagues ?? [];
  return `<div class="page-h"><div><h1>دوري الفرق</h1><p>فرق تدير الشركة نفسها بالأحداث نفسها، وتتنافس في جولات بمواعيد محددة. نتيجة الفريق متوسط نقاط أعضائه حتى يوم الجولة.</p></div></div>
  <div class="grid g-main">
    <section class="card"><h2>دورياتي</h2>
      ${state.loading ? '<div class="empty">جارٍ التحميل…</div>' : list.length ? `<div class="items">${list.map((l) => `<a class="item" href="#/league/${esc(l.id)}"><span class="ico">${icon('trophy')}</span><span><div class="tt">${esc(l.name)}</div><div class="meta"><span>${l.teams} فرق</span><span>${l.rounds} جولات</span></div></span><span></span></a>`).join('')}</div>`
        : '<div class="empty"><b>لست في دوري بعد</b>يضيفك المُيسِّر إلى فريق في دوري.</div>'}
    </section>
    ${fac ? `<section class="card"><h2>دوري جديد</h2>
      <form data-form="league-create" class="grid" style="gap:10px">
        <div class="field"><label for="lg-n">اسم الدوري</label><input id="lg-n" name="name" required placeholder="مثال: دوري جامعة الملك سعود — نوفمبر"></div>
        ${[1, 2, 3, 4].map((i) => `<div class="field"><label>الفريق ${i}${i > 2 ? ' <span class="muted small">(اختياري)</span>' : ''}</label><input name="team${i}" placeholder="اسم الفريق"><textarea name="emails${i}" rows="2" dir="ltr" placeholder="بريد الأعضاء، كل بريد في سطر"></textarea></div>`).join('')}
        <div class="field"><label>الجولات</label>
          ${[1, 2, 3].map((i) => `<div class="round-row"><input name="rt${i}" placeholder="الجولة ${i}" value="${['الأسبوع الأول', 'الأسبوع الثاني', 'الأسبوع الثالث'][i - 1]}"><input name="rd${i}" type="number" min="1" max="30" value="${i * 5}" title="حتى يوم العمل"><input name="rx${i}" type="datetime-local" dir="ltr" title="الموعد النهائي"></div>`).join('')}
          <span class="small muted">لكل جولة: حتى أي يوم عمل، والموعد النهائي الذي يجب أن يصل فيه الأعضاء إلى ذلك اليوم.</span></div>
        <div class="actions"><button class="btn primary" type="submit">إنشاء الدوري</button></div>
      </form></section>` : ''}
  </div>`;
}

export function leaguePage(l) {
  if (!l) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  const table = (rows) => `<table class="board"><thead><tr><th>#</th><th>الفريق</th><th>النتيجة</th><th>وصلوا</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr class="${l.myTeam?.id === r.teamId ? 'you' : ''}"><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="num"><b>${r.score ?? '—'}</b></td><td class="num">${r.finished} من ${r.members}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="page-h"><div><a href="#/leagues" class="small" style="text-decoration:none">→ دوري الفرق</a><h1>${esc(l.name)}</h1>
    <p>${l.myTeam ? `فريقك: <b>${esc(l.myTeam.name)}</b>` : 'أنت مُيسِّر هذا الدوري.'}</p></div>
    ${l.myTeam && !l.joined ? `<button class="btn primary" data-act="league-join" data-id="${esc(l.id)}" data-seed="${l.seed}">ابدأ شهر الدوري</button>` : ''}</div>
  ${l.myTeam && !l.joined ? '<div class="outcome info" style="margin-bottom:16px">لتُحتسب نتيجتك، ابدأ شهر الدوري: نفس الشركة ونفس الأحداث لكل الفرق. سيحلّ محل تقدمك الحالي (سجلاتك الموثّقة الصادرة لا تتأثر).</div>' : ''}
  <div class="grid g-main">
    <div>
      <section class="card"><h2>الترتيب العام</h2><table class="board"><thead><tr><th>#</th><th>الفريق</th><th>نقاط الدوري</th></tr></thead><tbody>
        ${l.overall.map((r, i) => `<tr class="${l.myTeam?.id === r.teamId ? 'you' : ''}"><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="num"><b>${r.points}</b></td></tr>`).join('')}</tbody></table>
        <p class="small muted">في كل جولة يحصل الأول على نقاط بعدد الفرق، والثاني أقل بنقطة، وهكذا.</p></section>
      ${l.rounds.map((r) => `<section class="card" style="margin-top:14px"><div class="office-h"><h2>${esc(r.title)}</h2><span class="pill ${r.closed ? 's-done' : 'p-high'}">${r.closed ? 'انتهت' : `تنتهي ${esc(dt(r.deadline))}`}</span></div>
        <p class="small muted" style="margin-top:0">التحدي: الوصول إلى نهاية يوم العمل ${r.untilDay} بأفضل أداء قبل الموعد.</p>${table(r.standings)}</section>`).join('')}
    </div>
    ${l.myTeam ? `<section class="card"><h2>فريقك</h2><ul class="feed">${l.myTeam.members.map((m) => `<li><span class="dot"></span><b>${esc(m.name)}</b>${m.you ? ' (أنت)' : ''} · ${m.joined ? `يوم ${m.day}` : '<span class="muted">لم يبدأ بعد</span>'}</li>`).join('')}</ul></section>` : ''}
  </div>`;
}

// ——— مكتبة الأعمال الواقعية ———

const WORK_STATUS = { pending: 'بانتظار القبول', assigned: 'مكلَّف: ابدأ العمل', submitted: 'سُلِّم: بانتظار المراجعة', approved: 'معتمد', revise: 'مطلوب تعديل', rejected: 'لم يُقبل', withdrawn: 'منسحب' };
const WORK_PILL = { pending: 't-pill', assigned: 'p-high', submitted: 'p-normal', approved: 's-done', revise: 'p-critical', rejected: 's-expired', withdrawn: 's-expired' };
const KIND_ICON = { customers: '📞', ux: '🧭', report: '📝', excel: '📊', marketing: '📣', legal: '⚖️', sales: '🤝', social: '📱', other: '💼' };
const INTERNAL_RULES = `<div class="outcome info internal-rules"><b>قواعد المشروع الداخلي لمحاكي</b><ul>
  <li>كل رسالة لجهة وكل منشور يُرسَل <b>مسودة</b> في التسليم، ولا يخرج إلا بعد <b>اعتماد المشرف</b>.</li>
  <li>لا تُشارك كلمات مرور حساباتنا: ينشر فريق محاكي المحتوى المعتمد من الحسابات الرسمية.</li>
  <li>قدّم محاكي بصدق: لا وعود بأسعار أو مزايا غير معتمدة، ولا تواصل مع جهة طلبت عدم التواصل.</li>
  <li>سجّل كل تواصل (الجهة، والتاريخ، والنتيجة) في تسليمك.</li></ul></div>`;

function realWorkCard(s) {
  if (!s?.count && !s?.market?.confirmed) return '';
  if (!s.count) return `<section class="card" style="margin-top:16px"><h2>أبحاث سوق معتمدة</h2><p class="small muted" style="margin-top:0">تظهر في سجلك الموثّق وملف أعمالك، منفصلة عن نقاط المحاكاة.</p>
    <div class="pf-stats small-stats"><div><b class="num">${s.market.confirmed}</b><span>أبحاث معتمدة</span></div><div><b class="num">${s.market.points}</b><span>نقاط بحث</span></div></div></section>`;
  return `<section class="card" style="margin-top:16px"><h2>أعمال واقعية موثّقة</h2>
    <p class="small muted" style="margin-top:0">أعمال حقيقية لجهات حقيقية، اعتمدها مراجع. تظهر في سجلك الموثّق وملف أعمالك، منفصلة عن نقاط المحاكاة.</p>
    <div class="pf-stats small-stats"><div><b class="num">${s.count}</b><span>أعمال معتمدة</span></div><div><b class="num">${s.points}</b><span>نقاط إنجاز واقعي</span></div>${s.market?.confirmed ? `<div><b class="num">${s.market.confirmed}</b><span>أبحاث سوق معتمدة (${s.market.points} نقطة)</span></div>` : ''}</div>
    <ul class="feed" style="margin-top:10px">${s.items.map((x) => `<li><span class="dot"></span>${esc(x.title)} · ${esc(x.org)} · ${x.rating} من 5</li>`).join('')}</ul></section>`;
}

export function workPage(state, gigId) {
  if (state.loading) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  if (state.error) return `<section class="card"><div class="empty"><b>تعذر التحميل</b>${esc(state.error)}</div></section>`;
  const d = state.data;
  const tab = state.tab ?? 'gigs';
  const t = (id, label) => `<button class="${tab === id ? 'on' : ''}" data-act="work-tab" data-tab="${id}">${label}</button>`;
  const head = `<div class="page-h"><div><h1>أعمال واقعية</h1><p>فرص عمل حقيقية من جهات حقيقية، مدفوعة أو تطوعية: تواصل مع عملاء، واختبار تجربة مستخدم، وتقارير وملفات إكسل، وتسويق، وقضايا وعقود. تُفتح بتقدمك في المحاكاة، ويعتمدها مراجع، وتُضاف إلى سجلك الموثّق.</p></div></div>
    <section class="card readiness"><b>جاهزيتك:</b> أكملت <span class="num">${d.readiness.days}</span> يوم عمل · <span class="num">${d.readiness.points}</span> نقطة · أعمال معتمدة <span class="num">${d.summary.count}</span> (${d.summary.points} نقطة إنجاز واقعي)</section>`;
  const tabs = `<div class="tabs fac-tabs" style="margin:14px 0">${t('gigs', 'الفرص')}${t('market', 'أبحاث السوق')}${t('mine', 'أعمالي')}${d.reviewer ? t('review', 'المراجعة') : ''}${d.facilitator ? t('new', 'فرصة جديدة') : ''}</div>`;
  const gig = gigId && d.gigs.find((g) => g.id === gigId);
  if (gig) return `${head}${tabs}${gigDetail(gig)}`;
  let body = '';
  if (tab === 'gigs') {
    const open = d.gigs.filter((g) => g.status === 'open');
    body = open.length ? `<div class="grid g-2">${open.map(gigCard).join('')}</div>` : '<section class="card"><div class="empty"><b>لا توجد فرص مفتوحة الآن</b>تُضاف الفرص من الجهات الشريكة تباعًا. أكمل أيام عملك في المحاكاة لتكون جاهزًا حين تُفتح.</div></section>';
  } else if (tab === 'mine') {
    const mine = d.gigs.filter((g) => g.mine);
    body = mine.length ? `<div class="grid g-2">${mine.map(gigCard).join('')}</div>` : '<section class="card"><div class="empty"><b>لم تتقدم لأي فرصة بعد</b></div></section>';
  } else if (tab === 'market') {
    body = marketTab(state.market);
  } else if (tab === 'review') {
    body = reviewList(state.review ?? []);
  } else if (tab === 'new') {
    body = newGigForm();
  }
  return `${head}${tabs}${body}`;
}

function gigCard(g) {
  return `<a class="card gig ${g.locked ? 'locked' : ''}" href="#/work/${esc(g.id)}">
    <div class="gig-h"><span class="gig-k">${KIND_ICON[g.kind]} ${esc(g.kindLabel)}</span>${g.paid ? `<span class="pill s-done">مدفوعة · ${g.paid.amount} ر.س</span>` : g.commission ? `<span class="pill s-done">عمولة: ${esc(commissionText(g.commission))}</span>` : '<span class="pill t-pill">تطوعية</span>'}</div>
    ${g.internal ? '<span class="pill p-normal" style="margin-top:6px;display:inline-block">مشروع داخلي لمحاكي</span>' : ''}
    <h3>${esc(g.title)}</h3><p class="small muted">${esc(g.org)}</p>
    <div class="meta"><span class="pill t-pill">حتى ${g.points} نقطة</span><span class="pill t-pill">${g.left} من ${g.slots} مقاعد</span>${g.deadline ? `<span class="pill t-pill">حتى ${esc(new Date(g.deadline).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long' }))}</span>` : ''}</div>
    ${g.mine ? `<p style="margin:8px 0 0"><span class="pill ${WORK_PILL[g.mine.status]}">${WORK_STATUS[g.mine.status]}</span></p>` : g.locked ? `<p class="small" style="margin:8px 0 0">🔒 ${esc(g.locked)}</p>` : ''}
  </a>`;
}

function gigDetail(g) {
  const m = g.mine;
  let action = '';
  if (!m && g.locked) action = `<div class="outcome info">🔒 ${esc(g.locked)}</div>`;
  else if (!m && !g.left) action = '<div class="outcome info">اكتملت المقاعد.</div>';
  else if (!m) action = `<form data-form="work-apply" data-id="${esc(g.id)}" class="card-lite"><div class="field"><label for="w-note">لماذا أنت مناسب؟ <span class="muted small">(اختياري)</span></label><textarea id="w-note" name="note" rows="2" maxlength="800"></textarea></div>
      <div class="actions"><button class="btn primary" type="submit">تقدّم للفرصة</button></div></form>`;
  else {
    action = `<div class="outcome ${m.status === 'approved' ? 'good' : m.status === 'revise' || m.status === 'rejected' ? 'bad' : 'info'}"><b>${WORK_STATUS[m.status]}</b>
      ${m.feedback ? `<p class="small"><b>ملاحظة المراجع:</b> ${esc(m.feedback)}</p>` : ''}
      ${m.status === 'approved' ? `<p class="small">التقييم ${m.rating} من 5 · ${m.earned} نقطة إنجاز واقعي${m.commission?.amount ? ` · عمولتك: ${m.commission.amount} ر.س` : ''}${m.payout ? ` · الدفع: ${m.payout === 'paid' ? 'تم' : 'مستحق'}` : ''}</p>` : ''}</div>
      ${['assigned', 'revise'].includes(m.status) ? `<form data-form="work-submit" data-app="${esc(m.id)}" class="card-lite">
        <div class="field"><label for="w-text">ما أنجزته</label><textarea id="w-text" name="text" rows="5" maxlength="8000" placeholder="ملخص العمل والنتائج.">${esc(m.submission?.text ?? '')}</textarea></div>
        <div class="field"><label for="w-link">رابط العمل <span class="muted small">(مستند أو ملف مشترك)</span></label><input id="w-link" name="link" dir="ltr" value="${esc(m.submission?.link ?? '')}"></div>
        <div class="actions"><button class="btn primary" type="submit">تسليم العمل</button><button class="btn ghost" type="button" data-act="work-withdraw" data-app="${esc(m.id)}">انسحاب</button></div></form>` : ''}
      ${m.status === 'pending' ? `<div class="actions"><button class="btn ghost" data-act="work-withdraw" data-app="${esc(m.id)}">سحب الطلب</button></div>` : ''}`;
  }
  return `<section class="card detail"><a class="back-link" href="#/work">→ كل الفرص</a>
    <div class="chips"><span class="pill t-pill">${KIND_ICON[g.kind]} ${esc(g.kindLabel)}</span>${g.paid ? `<span class="pill s-done">مدفوعة · ${g.paid.amount} ر.س</span>` : '<span class="pill t-pill">تطوعية</span>'}<span class="pill t-pill">حتى ${g.points} نقطة</span></div>
    <h1>${esc(g.title)}</h1><p class="muted">${esc(g.org)}${g.internal ? ' · مشروع داخلي' : ''}${g.commission ? ` · عمولة: ${esc(commissionText(g.commission))}` : ''}</p>
    ${g.internal ? INTERNAL_RULES : ''}
    <h3 class="section-t">المطلوب</h3><p class="body">${esc(g.description)}</p>
    ${g.deliverable ? `<h3 class="section-t">المخرَج المتوقع</h3><p>${esc(g.deliverable)}</p>` : ''}
    ${g.link ? `<p><a href="${esc(g.link)}" target="_blank" rel="noopener">رابط العمل ↗</a></p>` : ''}
    ${g.paid ? '<p class="small muted">الأجر اتفاق بين الجهة والمتدرب ويُصرف خارج المنصة وفق الأنظمة (مثل وثيقة العمل الحر). المنصة تسجّل الحالة فقط.</p>' : ''}
    ${g.kind === 'legal' ? '<p class="small muted">الأعمال القانونية تحت إشراف مختص من الجهة، ولا تُعد استشارة قانونية.</p>' : ''}
    ${action}</section>`;
}

function reviewList(apps) {
  if (!apps.length) return '<section class="card"><div class="empty"><b>لا توجد طلبات للمراجعة</b></div></section>';
  return apps.map((a) => `<section class="card review-item">
    <div class="office-h"><h3 style="margin:0">${esc(a.gig.title)} <span class="small muted">· ${esc(a.gig.org)}</span></h3><span class="pill ${WORK_PILL[a.status]}">${WORK_STATUS[a.status]}</span></div>
    <p class="small">المتدرب: <b>${esc(a.trainee.name)}</b> · أكمل ${a.trainee.days} يوم عمل · ${a.trainee.points} نقطة${a.note ? ` · «${esc(a.note)}»` : ''}</p>
    ${a.submission ? `<div class="peer-doc">${esc(a.submission.text)}${a.submission.link ? `\n\n${esc(a.submission.link)}` : ''}</div>` : ''}
    ${a.status === 'pending' ? `<div class="actions"><button class="btn primary" data-act="work-decide" data-app="${esc(a.id)}" data-action="accept">قبول وتكليف</button><button class="btn ghost" data-act="work-decide" data-app="${esc(a.id)}" data-action="reject">اعتذار</button></div>` : ''}
    ${a.status === 'submitted' ? `<form data-form="work-review" data-app="${esc(a.id)}"><div class="field"><label>التقييم</label><span class="seg">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}"><span>${n}</span></label>`).join('')}</span></div>
      ${a.gig.commission ? `<div class="field"><label>${a.gig.commission.type === 'percent' ? 'قيمة الصفقة المحققة (ر.س)' : 'عدد النتائج المحققة'} <span class="muted small">· العمولة: ${esc(commissionText(a.gig.commission))}</span></label><input name="${a.gig.commission.type === 'percent' ? 'dealValue' : 'units'}" type="number" min="0" value="0"></div>` : ''}
      <div class="field"><label>ملاحظة للمتدرب</label><textarea name="feedback" rows="2"></textarea></div>
      <div class="actions"><button class="btn primary" name="action" value="approve" type="submit">${a.gig.internal ? 'اعتماد للإرسال والنشر' : 'اعتماد'}</button><button class="btn" name="action" value="revise" type="submit">طلب تعديل</button><button class="btn ghost" name="action" value="reject" type="submit">رفض</button></div></form>` : ''}
    ${a.status === 'approved' && a.payout === 'due' ? `<div class="actions"><button class="btn" data-act="work-decide" data-app="${esc(a.id)}" data-action="paid">تأكيد الصرف${a.commission?.amount ? ` (عمولة ${a.commission.amount} ر.س)` : ''}</button></div>` : ''}
  </section>`).join('');
}

function newGigForm() {
  return `<section class="card"><h2>فرصة جديدة من جهة شريكة</h2>
  <form data-form="work-new" class="grid" style="gap:10px">
    <div class="field"><label>العنوان</label><input name="title" required placeholder="مثال: اختبار تجربة الاستخدام لموقع حجز"></div>
    <div class="field"><label>الجهة</label><input name="org" required></div>
    <label class="consent"><input type="checkbox" name="internal"><span><b>مشروع داخلي لمحاكي</b> (بيع خدماتنا، ومنشوراتنا، وحساباتنا): كل تواصل أو منشور مسودة لا يخرج إلا باعتماد المشرف.</span></label>
    <div class="field"><label>عمولة متغيرة <span class="muted small">(اختياري: تختلف من فرصة لأخرى)</span></label>
      <div class="round-row"><select name="commissionType"><option value="">بلا عمولة</option><option value="percent">نسبة %</option><option value="fixed">مبلغ ثابت (ر.س)</option></select><input name="commissionValue" type="number" min="0" step="0.5" placeholder="القيمة"><input name="commissionCap" type="number" min="0" placeholder="حد أقصى (ر.س)"></div>
      <input name="commissionBasis" placeholder="على ماذا؟ مثال: من قيمة أول دفعة للجهة المشتركة"></div>
    <div class="field"><label>النوع</label><select name="kind">${Object.entries({ sales: 'التواصل مع الجهات لبيع خدماتنا', social: 'محتوى إعلاني وإدارة حساباتنا', customers: 'التواصل مع عملاء', ux: 'اختبار تجربة مستخدم', report: 'تقرير', excel: 'ملف إكسل وتحليل بيانات', marketing: 'تسويق', legal: 'قضية أو عقد', other: 'أخرى' }).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="field"><label>المطلوب</label><textarea name="description" rows="3" required></textarea></div>
    <div class="field"><label>المخرَج المتوقع</label><textarea name="deliverable" rows="2"></textarea></div>
    <div class="field"><label>رابط العمل <span class="muted small">(يظهر للمكلَّفين فقط)</span></label><input name="link" dir="ltr"></div>
    <div class="round-row"><input name="amount" type="number" min="0" placeholder="الأجر (ر.س) أو 0"><input name="points" type="number" min="10" max="200" value="50" title="النقاط"><input name="slots" type="number" min="1" max="50" value="1" title="المقاعد"></div>
    <div class="round-row"><input name="minDays" type="number" min="0" max="30" value="10" title="يُفتح بعد أيام"><input name="minPoints" type="number" min="0" max="1000" value="0" title="الحد الأدنى من النقاط"><input name="deadline" type="date" dir="ltr" title="الموعد"></div>
    <span class="small muted">الأجر · النقاط · المقاعد — ثم: يُفتح بعد كم يوم عمل · الحد الأدنى من النقاط · الموعد</span>
    <div class="field"><label>بريد مراجع من الجهة <span class="muted small">(اختياري: يراجع ويعتمد بنفسه)</span></label><input name="reviewerEmail" type="email" dir="ltr"></div>
    <div class="actions"><button class="btn primary" type="submit">نشر الفرصة</button></div>
  </form></section>`;
}

// ——— مصطلحات بيئة العمل (FYA وFYI…) ———

let jgCache = null;
/** يضع شرحًا عند المرور على كل مصطلح عمل في النص (النص مُهرَّب مسبقًا). */
export function jg(session, html) {
  const terms = session.world.library?.glossary ?? [];
  if (!terms.length) return html;
  if (!jgCache || jgCache.terms !== terms) {
    const map = new Map(terms.map((t) => [t.term.toLowerCase(), t]));
    const alt = terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|');
    jgCache = { terms, map, re: new RegExp(`(?<![A-Za-z0-9])(${alt})(?![A-Za-z0-9])`, 'gi') };
  }
  return html.replace(jgCache.re, (m) => {
    const t = jgCache.map.get(m.toLowerCase());
    // الاختصارات بالأحرف الكبيرة فقط، والكلمات (sync, deck…) بأي حالة
    if (!t || (t.term === t.term.toUpperCase() && m !== t.term)) return m;
    return `<abbr class="jg" title="${esc(`${t.full}: ${t.ar}`)}">${m}</abbr>`;
  });
}

function mailTags(item, sim) {
  if (item.status !== 'open') return '';
  const asap = item.priority === 'critical' || item.dueDay <= sim.day;
  return `<abbr class="tag fya" title="For Your Action: مطلوب منك إجراء">FYA</abbr>${asap ? '<abbr class="tag asap" title="As Soon As Possible: عاجل">ASAP</abbr>' : ''}`;
}

const commissionText = (c) => `${c.type === 'percent' ? `${c.value}%` : `${c.value} ر.س`} ${c.basis}${c.cap ? ` (بحد أقصى ${c.cap} ر.س)` : ''}`;

// ——— صفحة المتدرب: العمر والسيرة الذاتية وأرقام التواصل ———

export function profilePage(user) {
  if (!user) return '<section class="card"><div class="empty"><b>سجّل الدخول لتعبئة صفحتك</b></div></section>';
  const p = user.profile ?? {};
  const age = p.birthYear ? new Date().getFullYear() - p.birthYear : null;
  const f = (name, label, attrs = '', hint = '') => `<div class="field"><label for="pf-${name}">${label}</label><input id="pf-${name}" name="${name}" value="${esc(p[name] ?? '')}" ${attrs}>${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;
  const ta = (name, label, rows, ph) => `<div class="field"><label for="pf-${name}">${label}</label><textarea id="pf-${name}" name="${name}" rows="${rows}" placeholder="${ph}">${esc(p[name] ?? '')}</textarea></div>`;
  return `<div class="page-h"><div><h1>صفحتي</h1><p>بياناتك وسيرتك الذاتية وأرقام التواصل. كلها اختيارية، و<b>لا تُشارك مع جهات التوظيف إلا إذا فعّلت موافقة المشاركة</b> من "حسابي".</p></div></div>
  <div class="grid g-main">
    <form class="card" data-form="trainee-profile">
      <h2>البيانات الأساسية</h2>
      <div class="grid g-2">${f('birthYear', 'سنة الميلاد', 'type="number" min="1950" max="2012" dir="ltr"', age ? `العمر: ${age} سنة` : '')}${f('city', 'المدينة')}
        ${f('university', 'الجامعة')}${f('major', 'التخصص')}${f('graduationYear', 'سنة التخرج', 'type="number" min="1990" max="2040" dir="ltr"')}</div>
      <h2 style="margin-top:16px">أرقام التواصل</h2>
      <div class="grid g-2">${f('phone', 'الجوال', 'type="tel" dir="ltr" placeholder="+9665XXXXXXXX"')}${f('phone2', 'رقم آخر / واتساب', 'type="tel" dir="ltr"')}
        ${f('linkedin', 'لينكدإن', 'type="url" dir="ltr" placeholder="https://linkedin.com/in/…"')}</div>
      <h2 style="margin-top:16px">السيرة الذاتية</h2>
      ${ta('summary', 'نبذة', 3, 'من أنت، وما الذي تبحث عنه؟')}
      ${ta('education', 'التعليم والدورات', 3, 'الشهادة، والجهة، والسنة. كل بند في سطر.')}
      ${ta('experience', 'الخبرات والمشاريع', 4, 'تدريب، وعمل حر، ومشاريع تخرج. كل بند في سطر.')}
      ${f('skills', 'المهارات', 'placeholder="إكسل، تحليل بيانات، عرض وتقديم…"')}
      ${f('cvUrl', 'رابط ملف السيرة الذاتية (PDF)', 'type="url" dir="ltr" placeholder="https://…"', 'ارفع الملف على Google Drive أو غيره وضع رابطه هنا.')}
      <div class="actions"><button class="btn primary" type="submit">حفظ</button></div>
    </form>
    <section class="card cv-preview"><h2>كما تراها جهة التوظيف</h2>
      <h3 style="margin:6px 0 0">${esc(user.name)}</h3>
      <p class="small muted" style="margin:2px 0 8px">${[age && `${age} سنة`, p.city, p.major, p.university].filter(Boolean).map(esc).join(' · ') || 'أكمل بياناتك.'}</p>
      ${p.summary ? `<p>${esc(p.summary)}</p>` : ''}
      ${p.education ? `<h4>التعليم</h4><p class="pre">${esc(p.education)}</p>` : ''}
      ${p.experience ? `<h4>الخبرات</h4><p class="pre">${esc(p.experience)}</p>` : ''}
      ${p.skills ? `<h4>المهارات</h4><p>${esc(p.skills)}</p>` : ''}
      <h4>التواصل</h4><p class="small" dir="ltr" style="text-align:right">${[user.email, p.phone, p.phone2, p.linkedin].filter(Boolean).map(esc).join('<br>')}</p>
      ${p.cvUrl ? `<a class="btn" href="${esc(p.cvUrl)}" target="_blank" rel="noopener">ملف السيرة الذاتية ↗</a>` : ''}
      <p class="small muted" style="margin-top:12px">${user.consents?.employerSharing ? '✓ المشاركة مع جهات التوظيف مفعّلة.' : 'المشاركة مع جهات التوظيف غير مفعّلة: لا يرى هذه الصفحة غيرك.'}</p>
    </section>
  </div>`;
}

// ——— أسئلة تنمية المهارات (تظهر عشوائيًا خلال اليوم) ———

export function quizModal(world, q, picked = null) {
  const done = picked !== null;
  return `<div class="quiz"><div class="quiz-h"><span class="pill p-normal">سؤال سريع</span><span class="pill t-pill">${esc(world.quiz.skills[q.skill])}</span></div>
    <h2>${esc(q.q)}</h2>
    <div class="options">${q.options.map((o, i) => `<button type="button" class="opt quiz-opt ${done ? (i === q.answer ? 'right' : i === picked ? 'wrong' : '') : ''}" ${done ? 'disabled' : ''} data-act="quiz-answer" data-i="${i}"><span>${esc(o)}</span></button>`).join('')}</div>
    ${done ? `<div class="outcome ${picked === q.answer ? 'good' : 'info'}"><b>${picked === q.answer ? 'صحيح!' : 'ليست الأفضل.'}</b> ${esc(q.why)}</div>
      <div class="actions"><button class="btn primary" data-act="close-modal">متابعة العمل</button></div>`
      : '<div class="actions"><button class="btn ghost" data-act="close-modal">لاحقًا</button><span class="small muted">للتعلم فقط: لا يؤثر على نقاطك الرسمية.</span></div>'}</div>`;
}

function quizCard(session) {
  const qs = session.world.quiz?.questions ?? [];
  const answered = qs.filter((q) => q.id in (session.quiz ?? {}));
  if (!answered.length) return '';
  const right = answered.filter((q) => session.quiz[q.id] === 1).length;
  const by = {};
  for (const q of answered) { (by[q.skill] ??= [0, 0])[1]++; if (session.quiz[q.id] === 1) by[q.skill][0]++; }
  return `<section class="card" style="margin-top:16px"><h2>أسئلة تنمية المهارات</h2>
    <p class="small muted" style="margin-top:0">أسئلة سريعة تظهر خلال يومك. للتعلم، ولا تدخل في نقاطك الرسمية.</p>
    <div class="pf-stats small-stats"><div><b class="num">${right} / ${answered.length}</b><span>إجابات صحيحة</span></div><div><b class="num">${qs.length - answered.length}</b><span>أسئلة باقية</span></div></div>
    <div class="chips" style="margin-top:10px">${Object.entries(by).map(([k, [r, n]]) => `<span class="pill ${r === n ? 's-done' : 't-pill'}">${esc(session.world.quiz.skills[k])}: ${r}/${n}</span>`).join('')}</div>
    <div class="actions" style="margin-top:10px"><button class="btn" data-act="quiz-now">سؤال الآن</button></div></section>`;
}

// ——— جلسة التقييم القصيرة للشركات ———

const assessFrame = (inner) => `<div class="verify-wrap"><div class="brand verify-brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>${inner}
  <p class="disclaimer verify-note">NOVA TECH شركة افتراضية لأغراض التقييم. لا نطلب هوية ولا رقم جوال.</p></div>`;

/** بوابة المرشح: رابط غير صالح، أو تعليمات البدء، أو شكر بعد التسليم. */
export function assessGate(a) {
  if (a.error) return assessFrame(`<section class="card"><div class="empty"><b>رابط التقييم غير صالح</b>${esc(a.error)}</div></section>`);
  const i = a.info;
  if (i.finished) return assessFrame(`<section class="card"><div class="outcome good"><h3>سُلّمت جلستك. شكرًا ${esc(i.name)}!</h3>
    <p>وصلت نتيجتك إلى <b>${esc(i.company)}</b>، وسيتواصلون معك بالخطوة التالية. يمكنك إغلاق الصفحة.</p></div></section>`);
  return assessFrame(`<section class="card challenge-hero">
    <div class="muted small">${esc(i.company)} تدعوك إلى</div>
    <h1>يوم عمل تجريبي: ${esc(i.title)}</h1>
    <p>أهلًا ${esc(i.name)}. بدل المقابلة النظرية، ستعمل <b>ثلاثة أيام عمل مكثفة</b> ${esc(i.roleAs)} في NOVA TECH، شركة SaaS سعودية افتراضية. المدة المتوقعة نحو <b>${i.minutes} دقيقة</b>.</p>
    <ul class="checks-list">
      <li><b>بريد عمل</b> فيه رسائل وشكاوى ومهام. تكتب ردودك بحرية، لا اختيارات جاهزة.</li>
      <li><b>اجتماعات</b> يعترض فيها زملاؤك، وعليك أن تقنعهم بالأرقام.</li>
      <li><b>مستند</b> واحد تكتبه. كل ما تحتاجه من أرقام موجود في ملفات الشركة، ويمكنك سؤال زملائك.</li>
      <li>كل بند مهلته يومه: ما لا تنجزه قبل «إنهاء يوم العمل» يُحسب عليك. رتّب أولوياتك.</li>
      <li>يُحفظ تقدمك تلقائيًا، وتستطيع التوقف والعودة من الرابط نفسه. تُسلَّم الجلسة عند إنهاء اليوم الثالث.</li>
    </ul>
    <label class="consent"><input type="checkbox" id="assess-consent"><span>أوافق على معالجة إجاباتي في هذه الجلسة ومشاركة نتيجتها مع <b>${esc(i.company)}</b> لغرض التوظيف. يحكم على الحوارات نموذج ذكاء اصطناعي بمعايير موحدة لكل المرشحين.</span></label>
    <div class="actions"><button class="btn primary" data-act="assess-start">${i.startedAt ? 'أكمل الجلسة' : 'ابدأ الجلسة'}</button></div>
  </section>`);
}

/** تقرير المقارنة للشركة (برابط سري، دون حساب). */
export function assessReportPage(state) {
  const frame = (inner) => `<div class="pf-wrap" style="max-width:980px"><div class="brand verify-brand"><img src="assets/mark.svg" alt=""><span>محاكي</span><span class="en">MOHAKI</span></div>${inner}
    <p class="disclaimer verify-note">النتائج يحسبها خادم محاكي بإعادة تشغيل أفعال كل مرشح على العالم نفسه. هذا التقرير أداة مساعدة لقرار التوظيف، لا بديل عنه. الرابط سري: لا تشاركه خارج فريق التوظيف.</p></div>`;
  if (state.loading) return frame('<section class="card"><div class="empty">جارٍ التحميل…</div></section>');
  if (state.error) return frame(`<section class="card"><div class="empty"><b>تعذر فتح التقرير</b>${esc(state.error)}</div></section>`);
  const r = state.report;
  const ST = { invited: 'لم يبدأ', started: 'بدأ ولم يُكمل', finished: 'أكمل' };
  const rows = r.candidates.map((c, i) => {
    const open = state.open === String(i);
    const detail = open && c.points !== undefined ? `<tr class="cand-detail"><td colspan="6">
      <div class="grid g-2">
        <div><h4>المهارات</h4>${c.skills.map((s) => `<div class="barrow"><span>${esc(s.label)}</span><span class="num">${s.score}%</span>${bar(s.score)}</div>`).join('')}
          <p class="small"><b>الأقوى:</b> ${c.strengths.map(esc).join('، ')} · <b>للتطوير:</b> ${c.toImprove.map(esc).join('، ')}</p>
          <p class="small">أثره على الشركة مقابل عالم بلا قرارات: الإيراد الشهري ${c.impact.mrr >= 0 ? '+' : ''}${fmt(c.impact.mrr)} ر.س · رضا العملاء ${c.impact.health >= 0 ? '+' : ''}${c.impact.health}${c.missed ? ` · <b>${c.missed} بنود فاتت مهلتها</b>` : ''}</p></div>
        <div><h4>المستندات</h4>${c.deliverables.map((d) => `<details><summary><b>${esc(d.title)}</b> · ${d.score}%${d.missing.length ? ` · ينقصه: ${d.missing.map(esc).join('، ')}` : ''}</summary><div class="peer-doc">${esc(d.text)}</div></details>`).join('') || '<p class="small muted">لم يسلّم مستندًا.</p>'}</div>
      </div>
      <h4>القرارات والحوارات</h4>
      ${c.decisions.map((d) => `<article class="pf-item"><div class="small muted">اليوم ${d.day}${d.concerns ? ` · أجاب ${d.addressed} من ${d.concerns} اعتراضات` : ''}</div><b>${esc(d.title)}</b> ← ${esc(d.choice ?? '')}
        ${d.said.length ? d.said.map((t) => `<p class="pf-quote">«${esc(t)}»</p>`).join('') : d.rationale ? `<p class="pf-quote">«${esc(d.rationale)}»</p>` : ''}</article>`).join('')}
    </td></tr>` : '';
    return `<tr class="cand ${open ? 'on' : ''}" data-act="assess-toggle" data-i="${i}" tabindex="0">
      <td class="num">${c.points !== undefined ? i + 1 : '—'}</td><td><b>${esc(c.name)}</b></td>
      <td><span class="pill ${c.status === 'finished' ? 's-done' : c.status === 'started' ? 'p-high' : 't-pill'}">${ST[c.status]}${c.status === 'started' && c.day ? ` (اليوم ${c.day})` : ''}</span></td>
      <td class="num"><b>${c.points ?? '—'}</b></td><td>${esc(c.band ?? '')}</td><td class="num">${c.minutes ? `${c.minutes} د` : '—'}</td></tr>${detail}`;
  }).join('');
  return frame(`<section class="card pf-hero"><div class="muted small">تقرير يوم العمل التجريبي</div><h1>${esc(r.company)} · ${esc(r.title)}</h1>
    <p class="muted">${r.days} أيام عمل مكثفة في شركة افتراضية · كل المرشحين واجهوا المواقف نفسها بالضبط.</p>
    <div class="pf-stats small-stats"><div><b class="num">${r.summary.invited}</b><span>مدعوون</span></div><div><b class="num">${r.summary.started}</b><span>بدأوا</span></div><div><b class="num">${r.summary.finished}</b><span>أكملوا</span></div></div></section>
  <section class="card"><h2>المرشحون</h2><p class="small muted" style="margin-top:0">اضغط على مرشح لترى مهاراته وقراراته ونص حواراته ومستنده. النقاط من 1000.</p>
    <div class="tbl-wrap"><table class="board cand-tbl"><thead><tr><th>#</th><th>المرشح</th><th>الحالة</th><th>النقاط</th><th>المستوى</th><th>المدة</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="actions" style="margin-top:12px"><button class="btn" data-act="print">طباعة / حفظ PDF</button></div></section>`);
}

/** إدارة تقييمات الشركات (للمُيسِّر). */
export function assessAdminPage(user, state) {
  if (user?.role !== 'facilitator') return '<section class="card"><div class="empty"><b>هذه الصفحة للمُيسِّرين فقط</b></div></section>';
  const list = state.list ?? [];
  return `<div class="page-h"><div><a href="#/desk" class="small" style="text-decoration:none">→ العودة</a><h1>تقييمات الشركات</h1><p>«يوم عمل تجريبي بدل المقابلة»: أنشئ تقييمًا لشركة، وأرسل لكل مرشح رابطه، وأرسل للشركة رابط تقرير المقارنة.</p></div></div>
  <div class="grid g-main">
    <div>${state.loading ? '<section class="card"><div class="empty">جارٍ التحميل…</div></section>' : list.length ? list.map((a) => `<section class="card" style="margin-bottom:14px">
      <div class="office-h"><h2>${esc(a.company)} · ${esc(a.title)} <span class="pill t-pill">${esc(a.roleLabel)}</span></h2><span class="small muted">${a.minutes} دقيقة</span></div>
      <p class="small">رابط تقرير الشركة: <a href="${esc(a.reportLink)}" target="_blank" dir="ltr">${esc(a.reportLink)}</a> <button class="btn sm ghost" data-act="copy-url" data-url="${esc(a.reportLink)}">نسخ</button></p>
      <table class="board"><thead><tr><th>المرشح</th><th>الحالة</th><th>رابطه</th></tr></thead><tbody>${a.candidates.map((c) => `<tr><td>${esc(c.name)}${c.email ? `<br><span class="small muted" dir="ltr">${esc(c.email)}</span>` : ''}</td><td>${{ invited: 'لم يبدأ', started: 'بدأ', finished: 'أكمل' }[c.status]}</td><td><button class="btn sm ghost" data-act="copy-url" data-url="${esc(c.link)}">نسخ الرابط</button></td></tr>`).join('')}</tbody></table></section>`).join('')
      : '<section class="card"><div class="empty"><b>لا توجد تقييمات بعد</b></div></section>'}</div>
    <section class="card"><h2>تقييم جديد</h2>
      <form data-form="assess-new" class="grid" style="gap:10px">
        <div class="field"><label>الشركة</label><input name="company" required></div>
        <div class="field"><label>الدور</label><select name="role"><option value="pm">مدير منتجات (مبتدئ)</option><option value="sales">أخصائي مبيعات</option><option value="cs">أخصائي نجاح العملاء وخدمتهم</option></select></div>
        <div class="field"><label>مسمى الوظيفة عند الشركة <span class="muted small">(اختياري)</span></label><input name="title" placeholder="يظهر للمرشح وفي التقرير"></div>
        <div class="field"><label>المدة المتوقعة (دقيقة)</label><input name="minutes" type="number" min="30" max="240" value="120"></div>
        <div class="field"><label>المرشحون <span class="muted small">(كل مرشح في سطر: الاسم، ثم بريده اختياريًا)</span></label><textarea name="candidates" rows="5" required placeholder="أحمد سالم, ahmad@example.com&#10;منى فهد"></textarea>
          <span class="small muted">من له بريد تصله الدعوة تلقائيًا إن كان البريد مفعّلًا. وإلا انسخ الروابط وأرسلها.</span></div>
        <div class="actions"><button class="btn primary" type="submit">إنشاء التقييم</button></div>
      </form></section>
  </div>`;
}

// ——— ساعات اليوم ومهام البحث ———

const fmtH = (h) => (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0$/, ''));

function researchView(session, item) {
  const sim = session.sim;
  const spec = item.research;
  const nameOf = (id) => spec.places?.find((p) => p.id === id)?.label ?? session.person(id).name;
  if (item.status !== 'open') {
    const act = sim.actions.find((a) => a.itemId === item.id);
    if (item.status === 'expired' || !act?.research) return closedOutcome(session, item);
    const good = act.quality >= 0.6;
    return `<div class="outcome ${good ? 'good' : 'bad'}"><h3>${good ? 'جواب صحيح ومدعوم' : 'الجواب لم يصمد'} · ${Math.round(act.quality * 100)}%</h3>
      <ul class="evidence">${act.research.fields.map((f) => `<li>${f.ok ? '<span class="check">✓</span>' : '<span class="x">✗</span>'} ${esc(f.label)}: <b>${esc(String(f.given))}</b>${f.ok ? '' : ` · الصحيح: ${esc(String(spec.fields.find((x) => x.id === f.id).correct))}`}</li>`).join('')}</ul>
      <p class="small">سألت ${act.research.sources.length} مصادر، منها ${act.research.evidence} أعطتك بيانات.${act.research.evidence < 2 ? ' الجواب المعتمد يحتاج مصدرين على الأقل.' : ''}</p></div>
      <h3 class="section-t">ما جمعته</h3>${item.findings.map((f) => `<div class="finding ${f.data ? '' : 'empty'}"><b>${esc(nameOf(f.sourceId))}</b><p>${esc(f.text)}</p></div>`).join('')}`;
  }
  const asked = new Set([...item.findings.map((f) => f.sourceId), ...item.pending.map((p) => p.sourceId)]);
  const people = session.world.company.people.filter((p) => !p.external && (p.id !== 'junior' || sim.day >= 6));
  const btn = (id, label, sub, kind) => `<button type="button" class="src ${asked.has(id) ? 'asked' : ''}" data-act="research-ask" data-item="${esc(item.id)}" data-source="${esc(id)}" ${asked.has(id) ? 'disabled' : ''}>
      <span class="src-i">${kind === 'file' ? '🗂️' : '💬'}</span><span><b>${esc(label)}</b><small>${esc(sub)}</small></span></button>`;
  return `
    <div class="research">
      <div class="research-h"><h3 class="section-t">أين تبحث؟</h3><span class="small muted">كل استفسار يستهلك نصف ساعة. طلبات التحليل تأخذ ساعات عمل لتجهز، ولك ${2 - sim.slowToday} منها اليوم. لا أحد يخبرك من يعرف: اسأل، وقارن.</span></div>
      <div class="src-grid">${(spec.places ?? []).map((p) => btn(p.id, p.label, 'ملف', 'file')).join('')}${people.map((p) => btn(p.id, p.name, p.title, 'person')).join('')}</div>
      ${item.pending.length ? `<div class="outcome info pending"><b>طلبات قيد التجهيز</b>${item.pending.map((p) => `<div class="pend"><span>${esc(nameOf(p.sourceId))}</span><span class="num">يجهز بعد ${fmtH(Math.max(0, p.readyAt - sim.clock))} ساعات عمل</span></div>`).join('')}
        <div class="actions"><button class="btn" data-act="work-hour" ${sim.canAfford(1) ? '' : 'disabled'}>اعمل ساعة على شيء آخر</button><span class="small muted">الأفضل أن تنجز مهمة أخرى أثناء الانتظار. وما لا يجهز اليوم يصلك صباح الغد.</span></div></div>` : ''}
      <h3 class="section-t">ما جمعته (${item.findings.length})</h3>
      ${item.findings.length ? item.findings.map((f) => `<div class="finding ${f.data ? '' : 'empty'}"><b>${esc(nameOf(f.sourceId))}${f.slow ? ' <span class="pill s-done">تحليل</span>' : ''}</b><p>${esc(f.text)}</p></div>`).join('') : '<p class="small muted">لم تسأل أحدًا بعد.</p>'}
      <form data-form="research" data-item="${esc(item.id)}" class="research-form">
        <h3 class="section-t">جوابك</h3>
        ${spec.fields.map((f) => `<div class="field"><label>${esc(f.label)}</label>${f.type === 'choice'
          ? `<span class="seg">${f.options.map((o) => `<label><input type="radio" name="${esc(f.id)}" value="${esc(o)}" required><span>${esc(o)}</span></label>`).join('')}</span>`
          : `<input name="${esc(f.id)}" type="number" step="any" required dir="ltr" style="max-width:220px">`}</div>`).join('')}
        <div class="actions"><button class="btn primary" type="submit">سلّم الجواب</button><span class="small muted">الجواب المعتمد يحتاج مصدرين على الأقل يدعمانه. بعد التسليم لا يمكن التعديل.</span></div>
      </form>
    </div>`;
}

// ——— بحث السوق الحقيقي بتطابق الإجابات ———

const M_STATUS = { open: 'مفتوح', consensus: 'معتمد بتطابق الإجابات', same_source: 'ينتظر المُيسِّر (مصدر واحد)', disputed: 'إجابات متضاربة', confirmed: 'حسمه المُيسِّر' };

function marketTab(m) {
  if (!m) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  const valueInput = (q) => (q.type === 'choice'
    ? `<span class="seg">${q.options.map((o) => `<label><input type="radio" name="value" value="${esc(o)}" required><span>${esc(o)}</span></label>`).join('')}</span>`
    : `<input name="value" type="number" step="any" required dir="ltr" style="max-width:200px"> ${esc(q.unit ?? '')}`);
  const card = (q) => `<section class="card market-q">
    <div class="office-h"><h3 style="margin:0">${esc(q.title)}</h3><span class="pill ${q.status === 'consensus' || q.status === 'confirmed' ? 's-done' : 't-pill'}">${M_STATUS[q.status]}</span></div>
    <p>${esc(q.question)}</p>
    <div class="chips"><span class="pill t-pill">${q.points} نقطة</span><span class="pill t-pill">${q.answers} من ${q.slots} باحثين</span></div>
    ${q.mine ? `<div class="outcome ${q.mine.matched === true ? 'good' : q.mine.matched === false ? 'bad' : 'info'}"><b>إجابتك: ${esc(String(q.mine.value))} ${esc(q.unit ?? '')}</b>
        ${q.result ? ` · الجواب المعتمد: <b>${esc(String(q.result.value))} ${esc(q.unit ?? '')}</b> · ${q.mine.matched ? `+${q.mine.points} نقطة` : 'لم تطابق'}` : ' · بانتظار إجابات زملائك.'}
        <br><span class="small" dir="ltr">${esc(q.mine.sourceUrl)}</span></div>`
      : q.locked ? `<div class="outcome info">🔒 ${esc(q.locked)}</div>`
      : q.all ? '' : `<form data-form="market-answer" data-id="${esc(q.id)}" class="card-lite">
        <div class="field"><label>جوابك</label>${valueInput(q)}</div>
        <div class="field"><label>رابط المصدر <span class="muted small">(الصفحة التي وجدت فيها الجواب)</span></label><input name="sourceUrl" type="url" required dir="ltr" placeholder="https://…"></div>
        <div class="field"><label>ملاحظة <span class="muted small">(اختياري: كيف وصلت للجواب)</span></label><input name="note" maxlength="500"></div>
        <div class="actions"><button class="btn primary" type="submit">أرسل الجواب</button><span class="small muted">لا ترى إجابات زملائك قبل أن تجيب. جواب واحد لكل سؤال.</span></div></form>`}
    ${q.all ? `<table class="board"><thead><tr><th>الباحث</th><th>الجواب</th><th>المصدر</th></tr></thead><tbody>${q.all.map((a) => `<tr><td>${esc(a.name)}</td><td class="num"><b>${esc(String(a.value))}</b></td><td><a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener" dir="ltr">${esc(a.domain)}</a>${a.note ? `<br><span class="small muted">${esc(a.note)}</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">لا إجابات بعد.</td></tr>'}</tbody></table>
      ${q.consensus ? `<p class="small">الأغلبية: <b>${esc(String(q.consensus.value))}</b> (${q.consensus.agree} من ${q.consensus.total}، من ${q.consensus.domains} مواقع).</p>` : ''}
      <form data-form="market-confirm" data-id="${esc(q.id)}" class="actions"><span class="small">الجواب النهائي:</span>${q.type === 'choice' ? `<select name="value">${q.options.map((o) => `<option ${String(q.consensus?.value) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input name="value" type="number" step="any" dir="ltr" value="${esc(String(q.result?.value ?? q.consensus?.value ?? ''))}" style="max-width:140px">`}<button class="btn" type="submit">${q.status === 'confirmed' ? 'تعديل الحسم' : 'حسم'}</button></form>` : ''}
  </section>`;
  return `<section class="card readiness"><b>أبحاث السوق:</b> أجبت عن <span class="num">${m.summary.answered}</span> · اعتُمد منها <span class="num">${m.summary.confirmed}</span> · <span class="num">${m.summary.points}</span> نقطة بحث
      <p class="small muted" style="margin:6px 0 0">السؤال نفسه يُعطى لعدة متدربين. ابحث على الإنترنت وأرفق مصدرك. يُعتمد الجواب حين تتطابق أغلبية الإجابات من مصادر مختلفة. هذه النقاط منفصلة عن نقاط المحاكاة.</p></section>
    ${m.questions.length ? m.questions.map(card).join('') : '<section class="card" style="margin-top:12px"><div class="empty"><b>لا توجد أسئلة بحث مفتوحة الآن</b></div></section>'}
    ${m.facilitator ? `<section class="card" style="margin-top:12px"><h2>سؤال بحث جديد</h2>
      <form data-form="market-new" class="grid" style="gap:10px">
        <div class="field"><label>العنوان</label><input name="title" required placeholder="مثال: سعر الباقة الأساسية لنظام منافس"></div>
        <div class="field"><label>السؤال</label><textarea name="question" rows="2" required placeholder="سؤال له جواب واحد يمكن التحقق منه، مع ما يُرفق مصدرًا."></textarea></div>
        <div class="round-row"><select name="type"><option value="number">جواب رقمي</option><option value="choice">اختيار من خيارات</option></select><input name="unit" placeholder="الوحدة (ر.س، %…)"><input name="tolerancePct" type="number" min="0" max="50" value="10" title="هامش التطابق %"></div>
        <div class="field"><label>الخيارات <span class="muted small">(للاختيار فقط، كل خيار في سطر)</span></label><textarea name="options" rows="2"></textarea></div>
        <div class="round-row"><input name="points" type="number" min="5" max="100" value="20" title="النقاط"><input name="slots" type="number" min="3" max="15" value="5" title="عدد الباحثين"><input name="minDays" type="number" min="0" max="30" value="5" title="يُفتح بعد أيام"></div>
        <span class="small muted">النوع · الوحدة · هامش التطابق % — ثم: النقاط · عدد الباحثين · يُفتح بعد كم يوم عمل</span>
        <div class="actions"><button class="btn primary" type="submit">نشر السؤال</button></div>
      </form></section>` : ''}`;
}

// ——— خطتي: الهدف والجاهزية لسوق العمل ———

/** يجمع حالة المتدرب من الجلسة والحساب وما حُمّل من الخادم، ويبني خطته. */
export function planOf(session, extra = {}) {
  const sim = session.sim;
  const r = sim.report();
  const pts = computePoints(r, { finished: sim.finished });
  const scored = r.skills.filter((x) => x.score !== null).sort((a, b) => a.score - b.score);
  const u = session.user;
  return buildPlan({
    days: r.daysWorked, lengthDays: sim.lastDay, finished: sim.finished, points: pts.points, weakest: scored[0] ?? null,
    hasRecord: !!u?.records?.length, emailVerified: !!u?.emailVerified, profile: u?.profile, sharing: !!u?.consents?.employerSharing,
    portfolioPublished: !!extra.portfolioPublished, realWork: extra.realWork ?? 0, market: extra.market ?? 0, videoMade: !!session.videoMade, goal: session.goal,
  });
}

function planStrip(session) {
  const p = planOf(session, session.planExtra ?? {});
  return `<a class="card plan-strip" href="#/plan" style="margin-top:16px">
    <div class="plan-ring">${ring(p.readiness, 76, '#00C2D1')}<b class="num">${p.readiness}</b></div>
    <div><div class="small muted">جاهزيتك لسوق العمل${session.goal?.role && session.goal.role !== 'undecided' ? ` · هدفك: ${esc(GOAL_ROLES[session.goal.role])}` : ''}</div>
      <b>${esc(p.band)}</b>${p.next ? `<div class="small">خطوتك التالية: <b>${esc(p.next.label)}</b>${p.next.hint ? ` <span class="muted">(${esc(p.next.hint)})</span>` : ''}</div>` : '<div class="small">أكملت خطتك. أحسنت!</div>'}</div>
    <span class="plan-go">خطتي ←</span></a>`;
}

export function goalModal(goal = null) {
  const pick = (name, map, cur) => Object.entries(map).map(([k, v]) => `<label class="opt"><input type="radio" name="${name}" value="${k}" ${cur === k ? 'checked' : ''} required><span>${esc(v)}</span></label>`).join('');
  return `<form data-form="goal"><h2>قبل أن تبدأ: ما هدفك؟</h2>
    <p class="muted" style="margin-top:0">نبني لك خطة على هدفك، ونريك كل يوم أين تقف منها.</p>
    <fieldset class="options"><legend class="section-t">أي وظيفة تسعى إليها؟</legend>${pick('role', GOAL_ROLES, goal?.role)}</fieldset>
    <fieldset class="options"><legend class="section-t">ما أكثر ما ينقصك الآن؟</legend>${pick('need', GOAL_NEEDS, goal?.need)}</fieldset>
    <div class="actions"><button class="btn primary" type="submit">ابنِ خطتي</button></div>
    <p class="small muted">محاكي يساعدك على بناء خبرة وإثباتها. لا نعد بوظيفة، والفرص تأتي مع تقدمك.</p></form>`;
}

export function planPage(session, extra = {}) {
  const p = planOf(session, extra);
  const g = session.goal;
  const NEED_TIP = {
    experience: 'ما تنجزه هنا يُكتب في سيرتك: شهر عمل، ومستندات، وأعمال واقعية معتمدة.',
    level: 'تابع نقاطك ومهاراتك في "تطورك المهني"، وأجب عن أسئلة المهارات التي تظهر خلال يومك.',
    confidence: 'ركّز على الاجتماعات والمحادثات: كل واحدة تدريب على موقف ستواجهه فعلًا.',
    proof: 'هدفك الأقرب: السجل الموثّق وملف الأعمال. كلاهما يتحقق منه صاحب العمل بنفسه.',
  };
  return `<div class="page-h"><div><h1>خطتي</h1><p>طريقك من أول يوم إلى أن يراك أصحاب العمل. كل بند يُحسب مما أنجزته فعلًا.</p></div>
    <button class="btn" data-act="edit-goal">${g ? 'عدّل هدفي' : 'حدّد هدفي'}</button></div>
  <div class="grid g-main">
    <div>
      ${p.next ? `<section class="card plan-next"><div class="small muted">خطوتك التالية · ${esc(p.next.stage)}</div><h2>${esc(p.next.label)}</h2>${p.next.hint ? `<p class="small muted">${esc(p.next.hint)}</p>` : ''}
        <a class="btn primary" href="${esc(p.next.href)}">ابدأ الآن</a></section>` : '<section class="card plan-next"><h2>أكملت خطتك 👏</h2><p>حدّث ملف أعمالك، وتابع الفرص الجديدة في الأعمال الواقعية.</p></section>'}
      ${p.stages.map((st, i) => { const done = st.items.filter((x) => x.done).length; return `<section class="card plan-stage ${done === st.items.length ? 'complete' : ''}" style="margin-top:12px">
        <div class="office-h"><h2><span class="num-badge">${i + 1}</span> ${esc(st.title)} <span class="small muted">· ${esc(st.sub)}</span></h2><span class="pill ${done === st.items.length ? 's-done' : 't-pill'}">${done} من ${st.items.length}</span></div>
        ${st.items.map((x) => `<a class="plan-item ${x.done ? 'done' : ''}" href="${esc(x.href)}"><span class="tick">${x.done ? '✓' : ''}</span><span>${esc(x.label)}${x.hint && !x.done ? ` <span class="small muted">· ${esc(x.hint)}</span>` : ''}</span></a>`).join('')}
      </section>`; }).join('')}
    </div>
    <div>
      <section class="card" style="text-align:center"><div class="plan-ring big">${ring(p.readiness, 150, '#00C2D1')}<b class="num">${p.readiness}</b></div>
        <h2 style="margin:8px 0 2px">جاهزيتك لسوق العمل</h2><p class="muted" style="margin:0">${esc(p.band)} · ${p.done} من ${p.total} بندًا</p></section>
      <section class="card" style="margin-top:12px"><h2>كيف يُحسب المؤشر</h2>
        ${p.breakdown.map((b) => `<div class="barrow"><span>${esc(b.label)}</span><span class="num">${b.earned} / ${b.weight}</span><div class="bar"><i style="width:${(b.earned / b.weight) * 100}%;background:var(--teal)"></i></div></div>`).join('')}
        <p class="small muted" style="margin-bottom:0">مؤشر إرشادي يقيس ما أنجزته وأثبتّه. ليس وعدًا بوظيفة، والفرص تأتي مع تقدمك.</p></section>
      ${g?.role ? `<section class="card" style="margin-top:12px"><h2>هدفك</h2><p style="margin:0"><b>${esc(GOAL_ROLES[g.role] ?? '')}</b></p>
        ${g.need ? `<p class="small">${esc(NEED_TIP[g.need] ?? '')}</p>` : ''}
        <p class="small muted">${session.sim.scenario.rotation ? `شهرك في دور ${esc(session.sim.scenario.role.split('—')[0].trim())}، مع أسبوعين من التدوير في إدارتين أخريين لتفهم الشركة كلها.` : !['pm', 'undecided'].includes(g.role) ? 'شهرك الحالي في دور مدير المنتجات. مهاراته مشتركة بين كل الأدوار. شهر دورك يبدأ عند "ابدأ من جديد".' : ''}</p></section>` : ''}
    </div>
  </div>`;
}

function networkCard(n) {
  if (!n?.sessions) return '';
  return `<section class="card" style="margin-top:16px"><h2>شبكة العلاقات</h2>
    <p class="small muted" style="margin-top:0">دليل منفصل عن النقاط: من بنيت معه علاقة داخل الشركة وخارجها.</p>
    <div class="pf-stats"><div><b class="num">${n.internal}</b><span>زملاء جلست معهم</span></div><div><b class="num">${n.departments}</b><span>إدارات</span></div><div><b class="num">${n.external}</b><span>عملاء</span></div><div><b class="num">${n.trusted}</b><span>يثقون بك (65+)</span></div></div></section>`;
}

// ——— ملفي الوظيفي: الوصف والأهداف والصلاحيات والإجراءات وتقييم الأداء ———

const DECISION_CLS = { confirmed: 'good', extended: 'info', repeat: 'bad', in_progress: 'info' };

export function jobPage(session) {
  const sim = session.sim;
  const pack = packOf(session.world.roles, sim.scenario.id);
  if (!pack) return '<section class="card"><div class="empty"><b>لا يوجد ملف وظيفي لهذه الجلسة</b></div></section>';
  const a = appraise(pack, sim, computePoints(sim.report(), { finished: sim.finished }));
  const mgr = session.person(pack.reportsTo);
  const who = session.user?.name ?? 'الموظف';
  const stars = (n) => (n === null ? '—' : '●'.repeat(n) + '○'.repeat(5 - n));
  return `<div class="page-h"><div><h1>ملفي الوظيفي</h1><p>وصفك الوظيفي، وأهداف فترة التجربة، وما تملك قراره، وكيف تُقيَّم. كما في أي شركة.</p></div>
    ${sim.finished ? '<button class="btn" data-act="print">طباعة تقييم الأداء / PDF</button>' : ''}</div>
  <div class="grid g-main">
    <div>
      <section class="card jd"><div class="small muted">الوصف الوظيفي · NOVA TECH</div><h2>${esc(pack.title)}</h2>
        <table><tbody><tr><td class="muted">الإدارة</td><td>${esc(pack.dept)}</td></tr><tr><td class="muted">المدير المباشر</td><td>${esc(mgr.name)}</td></tr><tr><td class="muted">المستوى</td><td>${esc(pack.grade)}</td></tr><tr><td class="muted">فترة التجربة</td><td>${sim.lastDay} يوم عمل <span class="small muted">(${esc(pack.probation.note)})</span></td></tr></tbody></table>
        <h3 class="section-t">الغرض من الوظيفة</h3><p>${esc(pack.purpose)}</p>
        <h3 class="section-t">المسؤوليات</h3><ul>${pack.responsibilities.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3 class="section-t">مؤشرات الأداء</h3><div class="chips">${pack.kpis.map((x) => `<span class="pill t-pill">${esc(x)}</span>`).join('')}</div></section>
      <section class="card" style="margin-top:12px"><h2>مصفوفة الصلاحيات</h2><p class="small muted" style="margin-top:0">ما تقرره وحدك، وما يحتاج موافقة. تجاوزها يُسجَّل في تقييمك.</p>
        <div class="tbl-wrap"><table><thead><tr><th>القرار</th><th>صاحب الصلاحية</th><th>ملاحظة</th></tr></thead><tbody>${pack.authority.map((x) => `<tr><td>${esc(x.decision)}</td><td><span class="pill ${x.level === 'صلاحيتك' ? 's-done' : 'p-high'}">${esc(x.level)}</span></td><td class="small muted">${esc(x.note)}</td></tr>`).join('')}</tbody></table></div></section>
      <section class="card" style="margin-top:12px"><h2>إجراءات العمل</h2>${pack.sops.map((x) => `<details class="sop"><summary><b>${esc(x.title)}</b></summary><ol>${x.steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol></details>`).join('')}</section>
    </div>
    <div>
      <section class="card appraisal"><div class="small muted">تقييم الأداء · فترة التجربة</div><h2>${esc(who)}</h2>
        <div class="outcome ${DECISION_CLS[a.decision.id]}"><b>${a.finished ? 'قرار التثبيت: ' : ''}${esc(a.decision.label)}</b><br><span class="small">${esc(a.decision.text)}</span></div>
        <h3 class="section-t">أهداف الفترة <span class="muted small">(${a.achieved} من ${a.total})</span></h3>
        ${a.objectives.map((o) => `<div class="plan-item ${o.ok ? 'done' : ''}"><span class="tick">${o.ok ? '✓' : ''}</span><span>${esc(o.label)} <span class="small muted">· الآن: ${esc(o.actual)}</span></span></div>`).join('')}
        <h3 class="section-t" style="margin-top:14px">الجدارات</h3>
        <table class="comp"><tbody>${a.competencies.map((c) => `<tr><td>${esc(c.label)}</td><td class="stars" title="${c.rating ?? ''} من 5">${stars(c.rating)}</td><td class="small muted">${esc(c.ratingLabel)}</td></tr>`).join('')}</tbody></table>
        <h3 class="section-t" style="margin-top:14px">الالتزام بالصلاحيات والإجراءات</h3>
        ${a.violations.length ? `<ul class="small viol">${a.violations.map((v) => `<li><span class="pill ${v.kind === 'authority' ? 'p-critical' : 'p-high'}">${v.kind === 'authority' ? 'تجاوز صلاحية' : 'مخالفة إجراء'}</span> يوم ${v.day}: ${esc(v.rule)}</li>`).join('')}</ul>` : '<p class="small" style="margin:0">لا تجاوزات مسجلة.</p>'}
        ${a.days >= 5 ? `<h3 class="section-t" style="margin-top:14px">خطة التطوير</h3><ul class="small">${a.development.map((d) => `<li><b>${esc(d.competency)}:</b> ${esc(d.action)}</li>`).join('')}</ul>` : ''}
        ${a.decision.id === 'extended' || a.decision.id === 'repeat' ? '<p class="small muted">هذه ليست النهاية: ابدأ فترة جديدة من "ابدأ من جديد"، وركّز على خطة التطوير. يُحتسب لك أفضل ما تحققه.</p>' : ''}
      </section>
    </div>
  </div>`;
}

// ——— حساب الجهة: دفعات الأكاديميات والجامعات والشركات ———

export function orgPage(user, state, orgId) {
  const back = '<a href="#/desk" class="small" style="text-decoration:none">→ العودة</a>';
  if (!user) return `<section class="card"><div class="empty"><b>سجّل الدخول أولًا</b><button class="btn primary" data-act="open-auth" data-mode="login">تسجيل الدخول</button></div></section>`;
  if (state.loading) return '<section class="card"><div class="empty">جارٍ التحميل…</div></section>';
  if (state.error) return `<section class="card"><div class="empty"><b>${esc(state.error)}</b></div></section>`;
  const me = state.me ?? {};
  const m = me.membership;
  const join = `<section class="card" id="org-join"><h2>دفعتي</h2>${m
    ? `<p>أنت ضمن <b>${esc(m.cohort)}</b> في <b>${esc(m.org)}</b>.</p>
       <p class="small muted">تشاهد الجهة: اسمك وبريدك، ويوم العمل الذي وصلته، ونقاطك، وقرار فترة التجربة، وعدد التجاوزات، ورمز سجلك الموثّق. لا تشاهد نصوص حواراتك ولا مستنداتك.</p>
       <div class="actions"><button class="btn" data-act="org-leave">مغادرة الدفعة وإيقاف المشاركة</button></div>`
    : `<p class="small">إن أعطتك أكاديميتك أو جامعتك أو شركتك رمز دعوة، أدخله هنا.</p>
       <form data-form="org-join" class="grid" style="gap:10px">
         <div class="field"><label for="org-code">رمز الدعوة</label><input id="org-code" name="code" dir="ltr" maxlength="12" required style="text-transform:uppercase;letter-spacing:2px"></div>
         <label class="small" style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="consent" required> <span>أوافق على أن تشاهد الجهة صاحبة الرمز: اسمي وبريدي، وتقدمي، ونقاطي، وقرار فترة التجربة، ورمز سجلي. وأستطيع إيقاف ذلك بمغادرة الدفعة.</span></label>
         <div class="actions"><button class="btn primary" type="submit">انضمام</button></div>
       </form>`}</section>`;
  const create = me.facilitator ? `<section class="card" style="margin-top:14px"><h2>جهة جديدة</h2>
      <form data-form="org-new" class="grid" style="gap:10px">
        <div class="field"><label>اسم الجهة</label><input name="name" required minlength="2"></div>
        <div class="field"><label>النوع</label><select name="kind"><option value="academy">أكاديمية أو معسكر تدريب</option><option value="university">جامعة أو كلية</option><option value="company">شركة</option></select></div>
        <div class="field"><label>بريد مديري الجهة <span class="muted small">(مفصول بفواصل)</span></label><input name="managers" dir="ltr" placeholder="lead@academy.sa, ops@academy.sa"></div>
        <span class="small muted">مدير الجهة يسجّل في محاكي بهذا البريد ويؤكده، فتظهر له لوحة جهته.</span>
        <div class="actions"><button class="btn primary" type="submit">إنشاء الجهة</button></div>
      </form></section>` : '';
  const managed = me.managed ?? [];
  const org = state.org;
  const decisionPill = (x) => (x.decisionId ? `<span class="pill ${{ confirmed: 's-done', extended: 'p-medium', repeat: 'p-high', in_progress: 't-pill' }[x.decisionId] ?? 't-pill'}">${esc(x.decision)}</span>` : '—');
  const dash = org ? `
    ${managed.length > 1 ? `<div class="tabs" style="margin-bottom:12px">${managed.map((o) => `<a class="tab ${o.id === org.id ? 'on' : ''}" href="#/org/${esc(o.id)}">${esc(o.name)}</a>`).join('')}</div>` : ''}
    <section class="card" style="margin-bottom:14px"><div class="office-h"><h2>${esc(org.name)} <span class="pill t-pill">${esc(org.kindLabel)}</span></h2>
      <a class="btn sm" href="/api/orgs/${esc(org.id)}/export" download>تصدير الكل CSV</a></div>
      <p class="small muted">المديرون: <span dir="ltr">${esc(org.managers.join(', ') || '—')}</span></p>
      <form data-form="org-cohort" data-org="${esc(org.id)}" class="actions" style="align-items:flex-end"><div class="field" style="flex:1"><label>دفعة جديدة</label><input name="name" required minlength="2" placeholder="مثل: معسكر تحليل الأعمال، نوفمبر"></div><button class="btn primary" type="submit">إنشاء دفعة برمز دعوة</button></form>
    </section>
    ${org.cohorts.length ? org.cohorts.map((co) => `<section class="card cohort" style="margin-bottom:14px">
      <div class="office-h"><h2>${esc(co.name)}</h2><span>رمز الدعوة: <b dir="ltr" class="num" style="letter-spacing:2px">${esc(co.code)}</b> <button class="btn sm ghost" data-act="copy-url" data-url="${esc(co.code)}">نسخ</button> <a class="btn sm ghost" href="/api/orgs/${esc(org.id)}/export?cohort=${esc(co.id)}" download>CSV</a></span></div>
      <div class="kpis" style="display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 12px">
        ${[['انضموا', co.summary.joined], ['بدؤوا', co.summary.started], ['أكملوا الشهر', co.summary.finished], ['اجتازوا فترة التجربة', co.summary.confirmed], ['متوسط النقاط', co.summary.avgPoints ?? '—']].map(([l, v]) => `<div><div class="small muted">${l}</div><b class="num" style="font-size:20px">${v}</b></div>`).join('')}
      </div>
      ${co.members.length ? `<div style="overflow-x:auto"><table class="board"><thead><tr><th>المتدرب</th><th>الدور</th><th>اليوم</th><th>النقاط</th><th>الأهداف</th><th>قرار فترة التجربة</th><th>تجاوزات</th><th>السجل</th></tr></thead><tbody>
        ${co.members.map((x) => `<tr><td>${esc(x.name)}<br><span class="small muted" dir="ltr">${esc(x.email)}</span></td>${x.started
          ? `<td class="small">${esc(x.role)}</td><td class="num">${x.day}/${x.lengthDays}</td><td class="num"><b>${x.points}</b><br><span class="small muted">${esc(x.band)}</span></td><td class="num">${esc(x.objectives ?? '—')}</td><td>${decisionPill(x)}</td><td class="num">${x.violations}</td><td>${x.record ? `<a href="#/verify/${esc(x.record)}" target="_blank" dir="ltr">${esc(x.record)}</a>` : '—'}</td>`
          : '<td colspan="7" class="muted small">لم يبدأ بعد</td>'}</tr>`).join('')}
        </tbody></table></div>` : '<div class="empty small">لم ينضم أحد بعد. أرسل رمز الدعوة لمتدربيك: يسجّلون في محاكي ثم يدخلون الرمز من «حسابي ← دفعتي».</div>'}
    </section>`).join('') : '<section class="card"><div class="empty"><b>لا توجد دفعات بعد</b><span class="small muted">أنشئ دفعة فتحصل على رمز دعوة.</span></div></section>'}` : '';
  return `<div class="page-h"><div>${back}<h1>${managed.length ? 'حساب الجهة' : 'دفعتي'}</h1><p>${managed.length ? 'دفعاتك في محاكي: من انضم، وأين وصل، وما قرار فترة التجربة لكل متدرب. الأرقام يحسبها الخادم من أفعال المتدرب.' : 'انضم إلى دفعة جهتك برمز الدعوة.'}</p></div></div>
  ${managed.length ? `<div class="grid g-main"><div>${dash}</div><div>${join}${create}</div></div>` : `<div class="grid g-2"><div>${join}</div><div>${create}</div></div>`}`;
}
