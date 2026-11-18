import { packOf } from '../../src/rolepack.js';

// بريد العمل: يجمع بنود المحرك (مهام ورسائل واجتماعات) مع بريد يُولَّد من حالة الشركة:
// التقرير الصباحي، وتعميم اجتماع الموظفين الأسبوعي، وإشعارات المستندات الجديدة في المكتبة.
// البريد المولَّد للعرض فقط، ولا يؤثر على المحرك (يُبنى من سجل الشركة نفسه).

const fmt = (n) => Math.round(n).toLocaleString('en');
const delta = (a, b, { invert = false, suffix = '' } = {}) => {
  const d = Math.round(a - b);
  if (!d) return '<span class="delta">—</span>';
  const good = invert ? d < 0 : d > 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}${suffix}</span>`;
};

/** كل البريد المولَّد حتى اليوم الحالي، الأحدث أولًا. */
export function generatedMail(session) {
  const sim = session.sim;
  const day = Math.min(sim.day, sim.lastDay);
  const out = [];
  for (let d = 2; d <= day; d++) out.push({ id: `mail:report:${d}`, kind: 'report', day: d, from: 'analyst', title: `التقرير الصباحي — يوم العمل ${d}` });
  if (packOf(session.world.roles, sim.scenario.id)) out.push({ id: 'mail:job', kind: 'job', day: 1, from: sim.scenario.manager, title: 'FYA: وصفك الوظيفي وأهداف فترة التجربة' });
  // مهام الجهة (الأكاديمية أو الجامعة): تصل كرسالة من المدير في يوم فتحها
  for (const t of session.orgTasks ?? []) if (t.unlockDay <= day) out.push({ id: `mail:orgtask:${t.id}`, kind: 'orgtask', day: t.unlockDay, from: sim.scenario.manager, title: `FYA: مهمة من ${session.orgName ?? 'جهتك'}: ${t.title}`, task: t });
  for (const m of sim.scenario.memos ?? []) if (m.day <= day) out.push({ id: `mail:memo:${m.day}`, kind: 'memo', day: m.day, from: m.from, title: m.title, memo: m });
  for (const doc of session.world.library?.docs ?? []) {
    if ((doc.fromDay ?? 1) > 1 && doc.fromDay <= day) out.push({ id: `mail:doc:${doc.id}`, kind: 'doc', day: doc.fromDay, from: doc.from, title: `مستند جديد في المكتبة: ${doc.title}`, doc });
  }
  return out.sort((a, b) => b.day - a.day || (a.kind === 'report' ? -1 : 1));
}

/** محتوى رسالة مولَّدة (HTML آمن: كل النصوص من بيانات السيناريو أو أرقام). */
export function mailBody(session, mail, esc) {
  const sim = session.sim;
  if (mail.kind === 'report') {
    const today = sim.history[mail.day - 1];
    const yday = sim.history[mail.day - 2] ?? today;
    const week = sim.history[Math.max(0, mail.day - 6)] ?? yday;
    if (!today) return '<p>لا توجد بيانات.</p>';
    const rows = [
      ['الإيراد الشهري المتكرر', `${fmt(today.mrr)} ر.س`, delta(today.mrr, yday.mrr), delta(today.mrr, week.mrr)],
      ['العملاء', fmt(today.customers), delta(today.customers, yday.customers), delta(today.customers, week.customers)],
      ['رضا العملاء', `${today.avgHealth}/100`, delta(today.avgHealth, yday.avgHealth), delta(today.avgHealth, week.avgHealth)],
      ['تذاكر الدعم المفتوحة', fmt(today.supportBacklog), delta(today.supportBacklog, yday.supportBacklog, { invert: true }), delta(today.supportBacklog, week.supportBacklog, { invert: true })],
      ['جودة المنتج', `${today.productQuality}/100`, delta(today.productQuality, yday.productQuality), delta(today.productQuality, week.productQuality)],
      ['معنويات الفريق', `${today.morale}/100`, delta(today.morale, yday.morale), delta(today.morale, week.morale)],
    ];
    const happened = sim.feed.filter((f) => f.day === mail.day - 1);
    const atRisk = sim.state.company.accounts.filter((a) => a.status === 'active' && a.health < 40);
    return `<p>صباح الخير. هذه أرقام نهاية يوم العمل ${mail.day - 1}:</p>
      <div class="tbl-wrap"><table class="report-tbl"><thead><tr><th>المؤشر</th><th>الآن</th><th>منذ أمس</th><th>خلال أسبوع</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td class="num"><b>${r[1]}</b></td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}</tbody></table></div>
      ${happened.length ? `<h3 class="section-t">ماذا حدث أمس</h3><ul class="feed-list">${happened.map((f) => `<li class="${f.tone}">${esc(f.text)}</li>`).join('')}</ul>` : ''}
      ${atRisk.length ? `<div class="outcome bad" style="margin-top:12px"><b>حسابات في خطر:</b> ${atRisk.map((a) => `${esc(a.name)} (رضا ${Math.round(a.health)})`).join('، ')}</div>` : ''}
      <p class="small muted">— فهد، فريق البيانات. التفاصيل في "نتائج الشركة".</p>`;
  }
  if (mail.kind === 'memo') {
    return `<p>إلى جميع الموظفين،</p><ul class="memo">${mail.memo.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><p class="small muted">هذا ملخص اجتماع الموظفين الأسبوعي (الخميس).</p>`;
  }
  if (mail.kind === 'job') {
    const pack = packOf(session.world.roles, sim.scenario.id);
    return `<p>أهلًا بك. PFA وصفك الوظيفي: <b>${esc(pack.title)}</b>، ${esc(pack.dept)}.</p>
      <p>فترة التجربة ${sim.lastDay} يوم عمل. اتفقنا على ${pack.objectives.length} أهداف تُراجَع في آخرها، ومعها يصدر قرار التثبيت:</p>
      <ul class="memo">${pack.objectives.map((o) => `<li>${esc(o.label)}</li>`).join('')}</ul>
      <p class="small muted">راجع مصفوفة الصلاحيات قبل أي وعد أو خصم: ما تقرره وحدك، وما يحتاج موافقة.</p>
      <div class="actions"><a class="btn primary" href="#/job">افتح ملفي الوظيفي</a></div>`;
  }
  if (mail.kind === 'orgtask') {
    const t = mail.task;
    return `<p>هذه مهمة من ${esc(session.orgName ?? 'جهتك')} ضمن يوم عملك. يقيّمها مدرّب الجهة بمعاييره، وتظهر نتيجتها في سجلك منفصلة عن نقاط المحاكاة.</p>
      <p><b>${esc(t.title)}</b></p><p style="white-space:pre-line">${esc(t.brief)}</p>
      <p class="small"><b>معايير التقييم:</b> ${t.criteria.map(esc).join('، ')}.${t.due ? ` <b>آخر موعد:</b> ${esc(t.due)}.` : ''}</p>
      <p class="small muted">${t.grade ? `قُيّمت: ${t.grade.score}%.` : t.submission ? 'سلّمتها، وتنتظر التقييم.' : 'لم تُسلَّم بعد.'}</p>
      <div class="actions"><a class="btn primary" href="#/org">${t.submission ? 'افتح المهمة' : 'افتح المهمة وسلّم عملك'}</a></div>`;
  }
  if (mail.kind === 'doc') {
    return `<p>أضفنا إلى مكتبة الشركة: <b>${esc(mail.doc.title)}</b>. ${esc(mail.doc.summary)}</p>
      <div class="actions"><a class="btn" href="#/library/${esc(mail.doc.id)}">افتح المستند (${mail.doc.minutes} دقائق)</a></div>`;
  }
  return '';
}
