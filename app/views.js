// شاشات بيئة العمل. كل دالة تعيد HTML من حالة المحرك الحالية.
import { roleOccupation } from '../src/occupations.js';
import { canMessage, DAILY_LIMIT } from '../src/agents/colleague.js';
import { computePoints, RECOMMENDATION_RULES } from '../src/points.js';
import {
  esc, fmt, sar, delta, words, PRIORITY, TYPE, STATUS, dueLabel, avatar, icon, typeIcon,
  lineChart, ring, bar, weekday, weekOf,
} from './lib/ui.js';

const PRIORITY_RANK = { critical: 3, high: 2, normal: 1, low: 0 };

// ——— الهيكل العام ———

export const NAV = [
  { id: 'desk', label: 'مكتبي', sub: 'ملخص يوم العمل', icon: 'desk' },
  { id: 'inbox', label: 'مهامي', sub: 'التكليفات والمواعيد', icon: 'inbox' },
  { id: 'team', label: 'فريقي', sub: 'الزملاء والمديرون', icon: 'team' },
  { id: 'meetings', label: 'الاجتماعات', sub: 'المواعيد والمناقشات', icon: 'meeting' },
  { id: 'files', label: 'ملفات الشركة', sub: 'بيانات وتقارير ومستندات', icon: 'files' },
  { id: 'company', label: 'نتائج الشركة', sub: 'الأداء والنمو والمؤشرات', icon: 'chart' },
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
        ${NAV.map((n) => `<a href="#/${n.id}" class="${route.page === n.id ? 'on' : ''}" ${route.page === n.id ? 'aria-current="page"' : ''}>
          ${icon(n.icon)}<span class="lbl">${n.label}<small>${n.sub}</small></span>
          ${badges[n.id] ? `<span class="badge">${badges[n.id]}</span>` : ''}
        </a>`).join('')}
      </nav>
      <div class="side-foot">
        <div class="me">${esc(session.user?.name ?? 'ضيف')}</div>
        <div>${esc(sim.scenario.role)}</div>
        ${session.user
          ? `<a href="#/account" class="side-link">حسابي</a> · <button type="button" data-act="logout">خروج</button>`
          : `<button type="button" class="side-cta" data-act="open-auth" data-mode="register">أنشئ حسابًا لحفظ تقدمك</button>`}
        <div><button type="button" data-act="reset">ابدأ من جديد</button></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="day">
          <b>${finished ? 'انتهت فترة العمل' : `يوم العمل ${day}`}</b>
          <span>${finished ? 'افتح سجلك المهني' : `${weekday(day)} · الأسبوع ${weekOf(day)} من ${Math.ceil(sim.lastDay / 5)} · ${dueToday ? `${dueToday} بند تنتهي مهلته اليوم` : 'لا مهلات تنتهي اليوم'}`}</span>
        </div>
        <div class="daybar" aria-hidden="true"><i style="width:${((day - (finished ? 0 : 1)) / sim.lastDay) * 100}%"></i></div>
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
    <p>${first
      ? 'لا توجد محاضرة تشرح لك ماذا تفعل. أمامك رسائل واجتماعات وشكوى عميل ومهام لها مواعيد تسليم. رتّب أولوياتك وابدأ.'
      : sim.finished ? 'راجع ما حققته بقراراتك في سجلك المهني.' : 'هذا ما ينتظرك اليوم. البنود التي تنتهي مهلتها اليوم ستُغلق عند نهاية يوم العمل، ولتجاهلها عواقب.'}</p>
    <div class="stats">
      <div><b class="num">${open.length}</b><span>بنود مفتوحة</span></div>
      <div><b class="num">${dueToday.length}</b><span>تنتهي اليوم</span></div>
      <div><b class="num">${critical.length}</b><span>حرجة</span></div>
      <div><b class="num">${trustMgr}</b><span>ثقة مديرك بك</span></div>
    </div>
    ${open.length ? `<div class="actions" style="position:relative;z-index:1"><a class="btn teal" href="#/inbox/${encodeURIComponent(open[0].id)}">ابدأ بالأهم: ${esc(open[0].title)}</a></div>` : ''}
  </section>

  ${first ? `<section class="card guide" style="margin-top:16px">
    <h2>كيف تعمل محاكي</h2>
    <ol>
      <li><b>صندوق العمل</b> فيه رسائل وشكاوى ومستندات واجتماعات. كل شيء تكتبه بحرية: محادثات، ومستندات، واجتماعات حوارية.</li>
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

function itemRow(session, item, activeId) {
  const sim = session.sim;
  const from = session.person(item.from);
  const due = dueLabel(item, sim.day);
  return `<a class="item ${item.id === activeId ? 'on' : ''} ${item.status !== 'open' ? 'done' : ''}" href="#/inbox/${encodeURIComponent(item.id)}">
    <span class="ico">${typeIcon(item.type)}</span>
    <span>
      <div class="tt">${esc(item.title)}</div>
      <div class="meta"><span>${esc(from.name)}</span>
        ${item.status === 'open' ? `<span class="pill p-${item.priority}">${PRIORITY[item.priority]}</span>` : `<span class="pill s-${item.status}">${STATUS[item.status]}</span>`}
        <span class="pill t-pill">${item.deliverable ? 'مستند' : item.dialogue?.mode === 'chat' ? 'محادثة' : TYPE[item.type] ?? ''}</span>
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
  const lists = {
    open: sim.inbox(),
    closed: all.filter((i) => i.status !== 'open'),
    all: [...sim.inbox(), ...all.filter((i) => i.status !== 'open')],
  };
  const list = lists[filter] ?? lists.open;
  const selected = itemId ? sim.items.find((i) => i.id === itemId) : list[0];
  const tab = (id, label) => `<a href="#/inbox${selected ? `/${encodeURIComponent(selected.id)}` : ''}?f=${id}" class="${filter === id ? 'on' : ''}">${label} <span class="num">${lists[id].length}</span></a>`;
  return `
  <div class="page-h"><div><h1>مهامي</h1><p>رسائل، اجتماعات، شكاوى، ومستندات مطلوب تسليمها.</p></div></div>
  <div class="inbox-layout ${itemId && selected ? 'has-sel' : ''}">
    <section class="card inbox-list" aria-label="قائمة البنود">
      <div class="tabs">${tab('open', 'مفتوحة')}${tab('closed', 'مغلقة')}${tab('all', 'الكل')}</div>
      ${list.length ? `<div class="items">${list.map((i) => itemRow(session, i, selected?.id)).join('')}</div>`
        : `<div class="empty"><b>${filter === 'open' ? 'لا توجد بنود مفتوحة' : 'لا شيء هنا بعد'}</b>${filter === 'open' ? 'أنجزت ما عليك اليوم.' : ''}</div>`}
    </section>
    <section class="card detail">${selected ? `<a class="back-link" href="#/inbox?f=${filter}">→ العودة إلى القائمة</a>` : ''}${selected ? itemDetail(session, selected, drafts, ui) : '<div class="empty"><b>اختر بندًا</b>لعرض تفاصيله والتصرف فيه.</div>'}</section>
  </div>`;
}

export function itemDetail(session, item, drafts = {}, ui = {}) {
  const sim = session.sim;
  const from = session.person(item.from);
  const due = dueLabel(item, sim.day);
  const head = `
    <div class="from">${avatar(from)}<div><b>${esc(from.name)}</b><div class="muted small">${esc(from.title)}</div></div></div>
    <div class="chips">
      <span class="pill p-${item.priority}">أولوية ${PRIORITY[item.priority]}</span>
      <span class="pill t-pill">${item.deliverable ? 'مستند مطلوب' : TYPE[item.type] ?? ''}</span>
      <span class="pill t-pill">وصل يوم ${item.createdDay}</span>
      ${item.status === 'open' ? `<span class="pill ${item.dueDay <= sim.day ? 'p-critical' : 't-pill'}">${due}</span>` : `<span class="pill s-${item.status}">${STATUS[item.status]}</span>`}
    </div>
    <h1>${esc(item.title)}</h1>
    <p class="body">${esc(item.body)}</p>`;

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

  if (item.status === 'open' && item.dialogue) return `${head}${meetingRoom(session, item, ui)}`;

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

export function team(session) {
  const sim = session.sim;
  const people = session.world.company.people;
  const directIds = [sim.scenario.manager, ...sim.scenario.team];
  const direct = directIds.map((id) => people.find((p) => p.id === id)).filter(Boolean);
  const others = people.filter((p) => !directIds.includes(p.id) && !p.external);
  const card = (p) => {
    const t = sim.state.player.trust[p.id];
    return `<section class="card person">${avatar(p)}<div style="flex:1;min-width:0">
      <div class="nm">${esc(p.name)}</div><div class="ti">${esc(p.title)}</div>
      <div class="pe">${esc(p.persona)}</div>
      ${t !== undefined ? `<div class="barrow"><span>ثقته بك</span><span class="num">${Math.round(t)}</span>${bar(t)}</div>`
        : '<div class="muted small">لم تتعامل معه مباشرة بعد.</div>'}
      <div class="tag-list" style="margin-top:10px">${(p.cares ?? []).map((c) => `<span class="pill t-pill">${esc(c)}</span>`).join('')}</div>
      ${canMessage(p) ? `<div class="actions" style="margin-top:12px"><a class="btn sm" href="#/team/${esc(p.id)}">راسل ${esc(firstName(p))}${session.thread(p.id).length ? ` <span class="muted num">(${session.thread(p.id).length})</span>` : ''}</a></div>` : ''}
    </div></section>`;
  };
  return `
  <div class="page-h"><div><h1>فريقي</h1><p>كل شخص في الشركة له أولوياته. الثقة تُبنى بالقرارات وتُفقد بالتجاهل والوعود غير المنفذة. ويمكنك مراسلة أي زميل في أي وقت لتسأله عمّا يعرفه.</p></div></div>
  <h2 class="section-t">مديرك وفريقك المباشر</h2>
  <div class="grid g-2">${direct.map(card).join('')}</div>
  <h2 class="section-t" style="margin-top:24px">بقية الشركة</h2>
  <div class="grid g-2">${others.map(card).join('')}</div>`;
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

export function report(session) {
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
  const badge = ui.agentMode === 'claude'
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
    <span class="pill ${ui.agentMode === 'claude' ? 'p-normal' : 't-pill'}">${ui.agentMode === 'claude' ? 'وكلاء Claude' : 'الوضع المحلي'}</span></div>
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
      <span><b>أوافق على معالجة بياناتي لأغراض التدريب والتقييم داخل محاكي</b> (مطلوب). تُحفظ قراراتك ومحادثاتك ونتائجك لحساب سجلك المهني. لا نطلب رقم الهوية أو الجوال.</span></label>
    <label class="consent"><input type="checkbox" name="employerSharing">
      <span><b>أوافق على مشاركة سجلي وبيانات التواصل مع جهات توظيف شريكة لمحاكي</b> (اختياري). لا يُشارك إلا إذا استوفيت شروط التوصية، ويمكنك سحب الموافقة في أي وقت.</span></label>` : ''}
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
