// أدوات العرض: الهروب من HTML، التنسيق، الأيقونات، والرسوم البيانية (SVG دون مكتبات).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmt = (n) => Math.round(n).toLocaleString('en');
export const sar = (n) => `${fmt(n)} <small>ر.س</small>`;
export const words = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean).length;

export function delta(now, before, { suffix = '', invert = false, digits = 0 } = {}) {
  const d = now - before;
  if (Math.abs(d) < (digits ? 0.05 : 0.5)) return '<span class="delta flat">— بلا تغيير</span>';
  const good = invert ? d < 0 : d > 0;
  const v = digits ? Math.abs(d).toFixed(digits) : fmt(Math.abs(d));
  return `<span class="delta ${good ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${v}${suffix}</span>`;
}

export const PRIORITY = {
  critical: 'حرجة', high: 'عالية', normal: 'عادية', low: 'منخفضة',
};
export const TYPE = {
  message: 'رسالة', meeting: 'اجتماع', complaint: 'شكوى', task: 'مهمة',
};
export const STATUS = { open: 'مفتوح', done: 'منجز', expired: 'فات موعده' };

export function dueLabel(item, day) {
  if (item.status !== 'open') return '';
  const left = item.dueDay - day;
  if (left <= 0) return 'تنتهي المهلة اليوم';
  if (left === 1) return 'المهلة: غدًا';
  return `المهلة: بعد ${left} أيام`;
}

const AVATAR_COLORS = ['#0B1F44', '#00808a', '#8a6400', '#3b5bdb', '#6b4fbb', '#1f9d63', '#c2410c', '#475569'];
export function avatar(person, cls = '') {
  const clean = (person.name || '?').replace(/^م\.\s*/, '');
  let h = 0;
  for (const ch of person.id || clean) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${cls}" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}" aria-hidden="true">${esc(clean[0])}</span>`;
}

const P = {
  desk: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  inbox: '<path d="M4 4h16v16H4z"/><path d="M4 14h4l2 3h4l2-3h4"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  meeting: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  files: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  growth: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  feed: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/>',
  task: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  complaint: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? P.message}</svg>`;
}
export const typeIcon = (type) => icon({ meeting: 'meeting', complaint: 'complaint', task: 'task' }[type] ?? 'message');

/** رسم خطي بسيط مع مساحة تحت المنحنى. */
export function lineChart(values, { color = '#00C2D1', height = 110, format = fmt, label = '' } = {}) {
  const W = 320, H = height, pad = 6;
  if (!values.length) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || Math.max(1, Math.abs(max) * 0.05);
  const lo = min - span * 0.15, hi = max + span * 0.15;
  const x = (i) => values.length === 1 ? W / 2 : pad + (i * (W - pad * 2)) / (values.length - 1);
  const y = (v) => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M${x(0)},${H} L${pts.join(' L')} L${x(values.length - 1)},${H} Z`;
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  const last = values[values.length - 1];
  return `<svg viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="${esc(label)}: من ${format(values[0])} إلى ${format(last)}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${id})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(values.length - 1)}" cy="${y(last)}" r="3.5" fill="${color}"/>
    <text x="${pad}" y="${H + 15}" font-size="11" fill="#7c879c">يوم 1</text>
    ${values.length > 1 ? `<text x="${W - pad}" y="${H + 15}" font-size="11" fill="#7c879c" text-anchor="end">يوم ${values.length}</text>` : ''}
  </svg>`;
}

export function ring(score, size = 150) {
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  const color = score >= 80 ? '#1f9d63' : score >= 60 ? '#00C2D1' : score >= 40 ? '#F5B301' : '#d64545';
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#edf0f5" stroke-width="12"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${(c * score) / 100} ${c}"/></svg>`;
}

export function bar(value, { cls = '', max = 100 } = {}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const auto = cls || (pct < 35 ? 'red' : pct < 55 ? 'amber' : '');
  return `<div class="bar ${auto}"><i style="width:${pct}%"></i></div>`;
}
