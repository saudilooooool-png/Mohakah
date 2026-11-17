// المكتب الحي: خريطة من الأعلى لمكتب NOVA TECH، والزملاء أيقونات تتحرك.
// تتحرك الشخصيات حين تنجز شيئًا (يأتي المدير ليستلم مستندك، ويذهب الحاضرون إلى غرفة الاجتماعات،
// ويأخذ ريان تكليفك إلى ركن البيانات)، ومن تلقاء نفسها أحيانًا (المطبخ، المستودع، زيارة زميل).
// للعرض فقط: لا يؤثر على المحرك.

const ROOMS = [
  { id: 'exec', label: 'الإدارة التنفيذية', x: 760, y: 20, w: 220, h: 130 },
  { id: 'cpo', label: 'مكتب خالد', x: 600, y: 20, w: 150, h: 130 },
  { id: 'meeting', label: 'غرفة الاجتماعات', x: 330, y: 20, w: 260, h: 130 },
  { id: 'eng', label: 'التطوير', x: 20, y: 20, w: 300, h: 130 },
  { id: 'product', label: 'فريق المنتجات', x: 330, y: 170, w: 380, h: 140 },
  { id: 'data', label: 'البيانات', x: 20, y: 170, w: 300, h: 140 },
  { id: 'sales', label: 'المبيعات والتسويق', x: 720, y: 170, w: 260, h: 140 },
  { id: 'cs', label: 'نجاح العملاء', x: 720, y: 330, w: 260, h: 110 },
  { id: 'kitchen', label: 'المطبخ', x: 470, y: 330, w: 240, h: 110 },
  { id: 'store', label: 'المستودع والأرشيف', x: 20, y: 330, w: 440, h: 110 },
];

// مقعد كل شخص (مركز الأيقونة)
const SEATS = {
  ceo: [830, 90], cfo: [920, 90], cpo: [675, 90],
  eng_lead: [100, 90], dev2: [200, 90],
  analyst: [110, 245], junior: [610, 270],
  me: [470, 245], mentor: [390, 270], ux: [560, 225],
  sales_head: [780, 245], marketing_lead: [900, 245],
  cs_lead: [850, 390],
};
const SPOTS = {
  meeting: [[380, 85], [430, 110], [480, 85], [530, 110], [460, 60], [560, 75]],
  kitchen: [[530, 390], [590, 395], [650, 385]],
  store: [[120, 395], [260, 390], [380, 395]],
};

const COLORS = ['#00C2D1', '#F5B301', '#7c5cff', '#1fa065', '#e2577d', '#3b82f6', '#f97316', '#0ea5a3', '#8b5cf6', '#ef4444', '#14b8a6', '#a16207'];
const pos = {};          // الموقع الحالي لكل شخص (يبقى بين إعادات الرسم)
let host = null;         // الحاوية الحالية
let ambientTimer = null;
let busy = new Set();    // من يتحرك الآن ضمن مشهد
let caption = '';

// الحرف الأول من الاسم الأول (الحروف العربية المتفرقة تُعرض معكوسة ومتصلة، فحرف واحد أوضح)
const initials = (name) => name.replace(/^(م\.|أ\.)\s*/, '').trim()[0] ?? '؟';

function people(session) {
  const ids = Object.keys(SEATS).filter((id) => id === 'me' || session.world.company.people.some((p) => p.id === id));
  // ريان يظهر من يوم انضمامه
  return ids.filter((id) => id !== 'junior' || session.sim.day >= 6);
}

function svg(session) {
  const ids = people(session);
  const nameOf = (id) => (id === 'me' ? 'أنت' : session.person(id).name.replace(/^(م\.|أ\.)\s*/, '').split(' ')[0]);
  return `<svg viewBox="0 0 1000 460" class="office-svg" role="img" aria-label="خريطة المكتب">
    <rect x="0" y="0" width="1000" height="460" rx="18" fill="#f3f6fb"/>
    ${ROOMS.map((r) => `<g><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="12" fill="${r.id === 'product' ? '#e6f9fb' : '#fff'}" stroke="#dfe5ef" stroke-width="2"/>
      <text x="${r.x + r.w / 2}" y="${r.y + 22}" text-anchor="middle" class="room-l">${r.label}</text></g>`).join('')}
    <rect x="${SEATS.me[0] - 34}" y="${SEATS.me[1] + 18}" width="68" height="10" rx="4" fill="#00C2D1" opacity=".5"/>
    ${ids.map((id, i) => {
      const [x, y] = pos[id] ?? SEATS[id];
      const me = id === 'me';
      const label = me ? 'أنت' : initials(session.person(id).name);
      return `<g class="ppl ${me ? 'me' : ''}" data-id="${id}" style="transform: translate(${x}px, ${y}px)" ${me ? '' : `data-href="#/team/${id}"`} tabindex="${me ? -1 : 0}" role="${me ? 'img' : 'link'}" aria-label="${nameOf(id)}">
        <circle r="${me ? 22 : 19}" fill="${me ? '#0B1F44' : COLORS[i % COLORS.length]}" stroke="#fff" stroke-width="3"/>
        <text y="6" text-anchor="middle" class="ppl-i ${me ? 'me-i' : ''}">${label}</text>
        <text y="${me ? 40 : 36}" text-anchor="middle" class="ppl-n">${nameOf(id)}</text>
      </g>`;
    }).join('')}
  </svg>
  <div class="office-cap" aria-live="polite">${caption}</div>`;
}

function node(id) { return host?.querySelector(`.ppl[data-id="${id}"]`); }

function moveTo(id, [x, y], ms = 1600) {
  pos[id] = [x, y];
  const el = node(id);
  if (el) { el.style.transition = `transform ${ms}ms ease-in-out`; el.style.transform = `translate(${x}px, ${y}px)`; }
  return new Promise((r) => setTimeout(r, ms));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = ([x, y], dx = 38) => [x + dx, y - 8];

function say(text) {
  caption = text;
  const el = host?.querySelector('.office-cap');
  if (el) el.textContent = text;
}

async function trip(id, target, { hold = 1400, label } = {}) {
  if (!SEATS[id] || busy.has(id)) return;
  busy.add(id);
  if (label) say(label);
  await moveTo(id, target);
  await wait(hold);
  await moveTo(id, SEATS[id]);
  busy.delete(id);
}

/** مشاهد تتبع أفعال المتدرب. */
export async function play(scene, session) {
  if (!scene) return;
  const name = (id) => session.person(id).name.replace(/^(م\.|أ\.)\s*/, '').split(' ')[0];
  if (scene.kind === 'delegate') {
    const id = scene.to;
    if (!SEATS[id]) return;
    busy.add(id);
    say(`${name(id)} يستلم تكليفك…`);
    await moveTo(id, near(SEATS.me));
    await wait(1000);
    say(`${name(id)} يبدأ التنفيذ مع الفريق.`);
    await moveTo(id, near(SEATS.analyst, -40));
    await wait(1500);
    await moveTo(id, SEATS[id]);
    busy.delete(id);
  } else if (scene.kind === 'deliver') {
    say(`${name('cpo')} جاء يستلم مستندك…`);
    busy.add('cpo');
    await moveTo('cpo', near(SEATS.me));
    await wait(900);
    say(`${name('cpo')} يأخذ مستندك إلى الإدارة.`);
    await moveTo('cpo', near(SEATS.ceo, -40));
    await wait(1600);
    await moveTo('cpo', SEATS.cpo);
    busy.delete('cpo');
  } else if (scene.kind === 'meeting') {
    const ids = [...scene.people.filter((p) => SEATS[p]), 'me'].slice(0, 6);
    say('الحاضرون يتجهون إلى غرفة الاجتماعات…');
    ids.forEach((p) => busy.add(p));
    await Promise.all(ids.map((p, i) => moveTo(p, SPOTS.meeting[i])));
    await wait(2200);
    say('انتهى الاجتماع، والكل يعود إلى مكتبه.');
    await Promise.all(ids.map((p) => moveTo(p, SEATS[p])));
    ids.forEach((p) => busy.delete(p));
  } else if (scene.kind === 'reply') {
    if (!SEATS[scene.from] || scene.from === 'me') return;
    await trip(scene.from, near(SEATS.me), { label: `${name(scene.from)} استلم ردك.` });
  } else if (scene.kind === 'insight') {
    if (!SEATS[scene.to]) return;
    await trip('me', near(SEATS[scene.to], -40), { label: `تتجه إلى ${name(scene.to)} لتبلغه بما اكتشفته.` });
  }
  say('');
}

/** حركة عفوية: زميل يذهب إلى المطبخ أو المستودع أو يزور زميلًا. */
function ambient(session) {
  clearTimeout(ambientTimer);
  const tick = async () => {
    if (!host || !document.body.contains(host)) { host = null; return; }
    if (!document.hidden) {
      const ids = people(session).filter((id) => id !== 'me' && !busy.has(id));
      const id = ids[Math.floor(Math.random() * ids.length)];
      const r = Math.random();
      const nm = session.person(id).name.replace(/^(م\.|أ\.)\s*/, '').split(' ')[0];
      if (r < 0.45) trip(id, SPOTS.kitchen[Math.floor(Math.random() * 3)], { hold: 2500, label: `${nm} في المطبخ.` }).then(() => say(''));
      else if (r < 0.7) trip(id, SPOTS.store[Math.floor(Math.random() * 3)], { hold: 2000, label: `${nm} يزور المستودع.` }).then(() => say(''));
      else {
        const other = ids.filter((x) => x !== id)[Math.floor(Math.random() * (ids.length - 1))];
        if (other) trip(id, near(SEATS[other]), { hold: 2200, label: `${nm} يناقش شيئًا مع ${session.person(other).name.split(' ')[0]}.` }).then(() => say(''));
      }
    }
    ambientTimer = setTimeout(tick, 5000 + Math.random() * 5000);
  };
  ambientTimer = setTimeout(tick, 2500);
}

/** يرسم المكتب في الحاوية ويشغّل المشهد المعلّق إن وُجد. */
export function mount(el, session, scene) {
  if (!el) return;
  host = el;
  el.innerHTML = svg(session);
  el.onclick = (e) => { const g = e.target.closest('.ppl[data-href]'); if (g) location.hash = g.dataset.href; };
  el.onkeydown = (e) => { const g = e.target.closest('.ppl[data-href]'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); location.hash = g.dataset.href; } };
  if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ambient(session);
  if (scene) play(scene, session);
}
