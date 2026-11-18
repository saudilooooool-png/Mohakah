// جولة تعريفية في المنصة: تُبرز كل قسم وتشرحه. تبدأ تلقائيًا أول مرة، وتُعاد من "جولة في المنصة".
const KEY = 'mohaki.tour.v1';

const STEPS = [
  { sel: '.co', title: 'شركتك: NOVA TECH', text: 'أنت موظف جديد في شركة SaaS سعودية افتراضية. كل ما تراه هنا يتغير بقراراتك.' },
  { sel: '.nav a[href="#/desk"]', title: 'مكتبي', text: 'ملخص يومك: ماذا ينتظرك، ومن أين تبدأ، وأين يقف زملاؤك في المكتب.' },
  { sel: '.nav a[href="#/inbox"]', title: 'مهامي (بريد العمل)', text: 'تصلك هنا الرسائل والمهام والشكاوى والتقارير. افتح الرسالة، اقرأ، ثم رد أو سلّم ما طُلب.' },
  { sel: '.nav a[href="#/library"]', title: 'المكتبة', text: 'ابدأ بدليل الموظف. تُفتح مستندات جديدة مع الأيام، وبعضها فيه ملاحظات مهمة لا يقولها أحد.' },
  { sel: '.nav a[href="#/team"]', title: 'فريقي', text: 'راسل أي زميل في أي وقت. سلمى مشرفتك في الأيام الأولى، وفهد عنده الأرقام.' },
  { sel: '.nav a[href="#/meetings"]', title: 'الاجتماعات', text: 'اجتماعات حوارية: تكتب بحرية، ويعترض الحاضرون، ويحسم رئيس الاجتماع.' },
  { sel: '.nav a[href="#/company"]', title: 'نتائج الشركة', text: 'الإيراد والعملاء والرضا والتذاكر. هنا ترى أثر قراراتك يومًا بيوم.' },
  { sel: '.nav a[href="#/report"]', title: 'تطورك المهني', text: 'نقاطك ومهاراتك وسجلك الموثّق، وتحدي أصدقائك وملف أعمالك.' },
  { sel: '[data-act="end-day"]', title: 'إنهاء يوم العمل', text: 'حين تنهي ما تستطيع، أنهِ اليوم. البنود التي فات موعدها لها عواقب، فرتّب أولوياتك.' },
  { sel: '[data-act="tour"]', title: 'هذه الجولة', text: 'تستطيع إعادتها في أي وقت من هنا. بالتوفيق في يومك الأول!' },
];

export const tourSeen = () => { try { return !!localStorage.getItem(KEY); } catch { return true; } };
const markSeen = () => { try { localStorage.setItem(KEY, '1'); } catch { /* */ } };

const visible = (el) => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';

export function startTour() {
  const steps = STEPS.filter((s) => visible(document.querySelector(s.sel)));
  if (!steps.length) return;
  let i = 0;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  const hole = root.querySelector('.tour-hole');
  const card = root.querySelector('.tour-card');
  const end = () => { markSeen(); root.remove(); window.removeEventListener('resize', place); document.removeEventListener('keydown', key); };
  function place() {
    const s = steps[i];
    const el = document.querySelector(s.sel);
    if (!visible(el)) { end(); return; }
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const pad = 6;
    Object.assign(hole.style, { top: `${r.top - pad}px`, left: `${r.left - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    card.innerHTML = `<div class="small muted">${i + 1} من ${steps.length}</div><h3>${s.title}</h3><p>${s.text}</p>
      <div class="actions">${i < steps.length - 1 ? '<button class="btn primary" data-t="next">التالي</button>' : '<button class="btn primary" data-t="end">ابدأ العمل</button>'}
      ${i > 0 ? '<button class="btn ghost" data-t="prev">السابق</button>' : ''}<button class="btn ghost" data-t="end">تخطَّ</button></div>`;
    const cw = Math.min(340, window.innerWidth - 32);
    card.style.width = `${cw}px`;
    const below = r.bottom + 14 + 200 < window.innerHeight;
    let left = r.left + r.width / 2 - cw / 2;
    // بجانب القائمة الجانبية (يمين) إن كان العنصر فيها
    if (r.left > window.innerWidth * 0.6 && window.innerWidth > 760) left = r.left - cw - 18;
    left = Math.max(16, Math.min(left, window.innerWidth - cw - 16));
    const top = r.left > window.innerWidth * 0.6 && window.innerWidth > 760 ? Math.max(16, Math.min(r.top - 10, window.innerHeight - 230)) : below ? r.bottom + 14 : Math.max(16, r.top - 214);
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
    card.querySelector('.btn.primary')?.focus();
  }
  function key(e) { if (e.key === 'Escape') end(); if (e.key === 'ArrowLeft' && i < steps.length - 1) { i++; place(); } if (e.key === 'ArrowRight' && i > 0) { i--; place(); } }
  card.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'next') { i++; place(); } else if (t === 'prev') { i--; place(); } else if (t === 'end') end();
  });
  window.addEventListener('resize', place);
  document.addEventListener('keydown', key);
  place();
}
