// فيديو "30 يومًا في NOVA TECH": يُرسم على لوحة (canvas) من بيانات ملف الأعمال الموثّق،
// ويُسجَّل داخل المتصفح بـMediaRecorder. لا خادم ولا مكتبات: تكلفة صفرية على المنصة.
//
// كل مشهد دالة نقية من الزمن t، فالإطار نفسه يُرسم دائمًا بالشكل نفسه (يسهل اختباره بلقطات).
// النصوص بلسان المتدرب (أنا/قراراتي) حتى لا تفترض جنسه.

export const W = 1080;
export const H = 1920;
const C = { navy: '#0B1F44', navy2: '#13295a', teal: '#00C2D1', amber: '#F5B301', white: '#ffffff', mute: '#9fb0d0', grey: '#7d8aa5' };
const FONT = '"IBM Plex Sans Arabic", system-ui, sans-serif';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (x) => 1 - (1 - clamp(x)) ** 3;
const fade = (t, start, len = 0.5) => ease((t - start) / len);

/** يقسم نصًا عربيًا إلى أسطر بعرض أقصى. */
function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function text(ctx, str, { x = W - 90, y, size = 64, weight = 700, color = C.white, alpha = 1, maxW = W - 180, lh = 1.35, align = 'right', maxLines = 6 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.direction = 'rtl';
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  let lines = wrap(ctx, str, maxW);
  if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] += '…'; }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
  ctx.restore();
  return y + lines.length * size * lh;
}

function pill(ctx, label, { x, y, color = C.teal, alpha = 1 }) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `700 38px ${FONT}`;
  ctx.direction = 'rtl';
  const w = ctx.measureText(label).width + 56;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(x - w, y, w, 70, 35); ctx.fill();
  ctx.fillStyle = C.navy; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x - 28, y + 37);
  ctx.restore();
}

function background(ctx, t) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, C.navy); g.addColorStop(1, '#0a1733');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // دوائر هادئة متحركة
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = C.teal;
  ctx.beginPath(); ctx.arc(900 + Math.sin(t / 3) * 40, 300, 260, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.amber;
  ctx.beginPath(); ctx.arc(120, 1650 + Math.cos(t / 4) * 40, 220, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function brand(ctx) {
  ctx.save();
  ctx.font = `700 40px ${FONT}`; ctx.fillStyle = C.white; ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText('محاكي · MOHAKI', W - 90, 90);
  ctx.restore();
}

function progressBar(ctx, t, total) {
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(90, H - 110, W - 180, 8);
  ctx.fillStyle = C.teal; ctx.fillRect(W - 90 - (W - 180) * clamp(t / total), H - 110, (W - 180) * clamp(t / total), 8);
}

function chart(ctx, you, base, { x0 = 90, y0 = 760, w = W - 180, h = 560, p = 1 }) {
  const all = [...you, ...base];
  const min = Math.min(...all) * 0.97; const max = Math.max(...all) * 1.03;
  const X = (i, n) => x0 + (i / Math.max(1, n - 1)) * w; // الزمن من اليسار إلى اليمين كما يُقرأ أي رسم بياني
  const Y = (v) => y0 + h - ((v - min) / (max - min || 1)) * h;
  const draw = (arr, color, width, dash) => {
    const n = arr.length; const upto = Math.max(1, Math.floor((n - 1) * p));
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i <= upto; i++) i ? ctx.lineTo(X(i, n), Y(arr[i])) : ctx.moveTo(X(i, n), Y(arr[i]));
    ctx.stroke(); ctx.restore();
    return [X(upto, n), Y(arr[upto])];
  };
  ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo(x0, y0 + (h / 4) * i); ctx.lineTo(x0 + w, y0 + (h / 4) * i); ctx.stroke(); }
  draw(base, C.grey, 7, [18, 14]);
  const [ex, ey] = draw(you, C.teal, 12, []);
  ctx.fillStyle = C.teal; ctx.beginPath(); ctx.arc(ex, ey, 16, 0, Math.PI * 2); ctx.fill();
}

const pctDelta = (a, b) => `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%`;

/** المشاهد ومددها بالثواني. */
export function scenes(d) {
  const hardest = [...d.decisions].filter((x) => x.dialogue).sort((a, b) => (b.concerns ?? 0) - (a.concerns ?? 0))[0] ?? d.decisions[0];
  // جملة قالها في اجتماع، وإلا مبرر قرار كتبه
  const quote = d.quotes[0]?.text ?? hardest?.rationale ?? '';
  const said = !!d.quotes[0];
  const list = [
    { id: 'intro', dur: 5 },
    hardest && { id: 'moment', dur: 6, hardest },
    quote && { id: 'quote', dur: 6, quote, said, from: d.quotes[0]?.title ?? hardest?.title },
    { id: 'impact', dur: 7 },
    { id: 'work', dur: 6 },
    { id: 'score', dur: 7 },
  ].filter(Boolean);
  let at = 0;
  for (const s of list) { s.start = at; at += s.dur; }
  return { list, total: at };
}

/** يرسم الإطار عند الزمن t (بالثواني). */
export function drawFrame(ctx, d, t, plan = scenes(d)) {
  background(ctx, t);
  brand(ctx);
  const s = plan.list.findLast((x) => t >= x.start) ?? plan.list[0];
  const lt = t - s.start;
  const out = s.dur - lt < 0.4 ? clamp((s.dur - lt) / 0.4) : 1; // تلاشٍ في آخر المشهد
  const a = (start, len) => fade(lt, start, len) * out;
  const name = d.name;

  if (s.id === 'intro') {
    pill(ctx, 'من محاكاة عمل حقيقية', { x: W - 90, y: 520, alpha: a(0, 0.5) });
    text(ctx, '30 يومًا', { y: 650, size: 150, alpha: a(0.3), color: C.teal });
    text(ctx, `في دور ${d.occupation?.titleAr ?? d.role.split('—')[0].trim()}`, { y: 850, size: 76, alpha: a(0.7), maxLines: 2 });
    text(ctx, `في ${d.company}، شركة SaaS سعودية`, { y: 1060, size: 54, weight: 400, color: C.mute, alpha: a(1.1) });
    text(ctx, name, { y: 1380, size: 64, alpha: a(1.6) });
    if (d.headline) text(ctx, d.headline, { y: 1480, size: 44, weight: 400, color: C.mute, alpha: a(1.9), maxLines: 2 });
  }

  if (s.id === 'moment') {
    const h = s.hardest;
    pill(ctx, `اليوم ${h.day}`, { x: W - 90, y: 420, alpha: a(0), color: C.amber });
    text(ctx, 'أصعب موقف', { y: 540, size: 56, weight: 400, color: C.mute, alpha: a(0.2) });
    const y = text(ctx, h.title, { y: 640, size: 82, alpha: a(0.4), maxLines: 3 });
    if (h.dialogue) text(ctx, `أجبت ${h.addressed} من ${h.concerns} اعتراضات من زملائي`, { y: y + 60, size: 50, color: C.teal, alpha: a(1.2) });
    text(ctx, 'قراري:', { y: y + 200, size: 46, weight: 400, color: C.mute, alpha: a(1.8) });
    text(ctx, h.choice, { y: y + 270, size: 58, alpha: a(2.1), maxLines: 4 });
  }

  if (s.id === 'quote') {
    ctx.save(); ctx.globalAlpha = 0.25 * a(0); ctx.font = `700 360px ${FONT}`; ctx.fillStyle = C.teal; ctx.textAlign = 'right'; ctx.fillText('«', W - 60, 650); ctx.restore();
    // كتابة تدريجية للجملة
    const full = s.quote;
    const shown = full.slice(0, Math.floor(full.length * clamp((lt - 0.4) / 3.2)));
    text(ctx, shown, { y: 720, size: 64, weight: 400, alpha: out, maxLines: 9, lh: 1.5 });
    text(ctx, `${s.said ? 'قلتها في' : 'كتبتها مبررًا لقراري في'}: ${s.from}`, { y: 1520, size: 42, color: C.mute, alpha: a(3.8), maxLines: 2 });
  }

  if (s.id === 'impact') {
    text(ctx, 'أثر قراراتي على الشركة', { y: 300, size: 70, alpha: a(0) });
    text(ctx, 'العالم نفسه بالأحداث نفسها، مرة بقراراتي ومرة دون أي قرار', { y: 420, size: 40, weight: 400, color: C.mute, alpha: a(0.3), maxLines: 2 });
    ctx.save(); ctx.globalAlpha = out;
    chart(ctx, d.series.you, d.series.baseline, { p: ease((lt - 0.6) / 3.5) });
    ctx.restore();
    text(ctx, `${pctDelta(d.impact.mrr, d.impact.mrrBaseline)} في الإيراد الشهري`, { y: 1440, size: 84, color: C.teal, alpha: a(4.2) });
    text(ctx, `${d.impact.customers - d.impact.customersBaseline >= 0 ? '+' : ''}${d.impact.customers - d.impact.customersBaseline} عميلًا · رضا العملاء ${d.impact.health - d.impact.healthBaseline >= 0 ? '+' : ''}${d.impact.health - d.impact.healthBaseline}`, { y: 1570, size: 48, weight: 400, alpha: a(4.8) });
  }

  if (s.id === 'work') {
    text(ctx, 'خلال الشهر', { y: 360, size: 70, alpha: a(0) });
    const rows = [[d.counts.decisions, 'قرارًا'], [d.counts.dialogues, 'اجتماعًا ومحادثة'], [d.counts.deliverables, 'مستندات كتبتها']];
    rows.forEach(([n, label], i) => {
      const al = a(0.4 + i * 0.5);
      text(ctx, String(Math.round(n * ease((lt - 0.4 - i * 0.5) / 1))), { y: 500 + i * 290, size: 140, color: C.teal, alpha: al });
      text(ctx, label, { y: 690 + i * 290, size: 50, alpha: al });
    });
    if (d.shipped.length) {
      text(ctx, 'أطلقت:', { y: 1380, size: 46, color: C.mute, weight: 400, alpha: a(2.2) });
      text(ctx, d.shipped.slice(0, 3).map((x) => x.title).join(' · '), { y: 1450, size: 46, alpha: a(2.5), maxLines: 3 });
    }
  }

  if (s.id === 'score') {
    pill(ctx, '✓ موثّق بإعادة التشغيل', { x: W - 90, y: 420, alpha: a(0) });
    const n = Math.round(d.points * ease((lt - 0.3) / 2));
    text(ctx, String(n), { y: 580, size: 260, color: C.white, alpha: a(0.3), x: W / 2, align: 'center' });
    text(ctx, 'نقطة من 1000', { y: 900, size: 56, weight: 400, color: C.mute, alpha: a(0.6), x: W / 2, align: 'center' });
    text(ctx, d.band, { y: 1000, size: 72, color: C.teal, alpha: a(2.2), x: W / 2, align: 'center' });
    text(ctx, 'شاهد أعمالي وتحقق بنفسك', { y: 1300, size: 50, alpha: a(3), x: W / 2, align: 'center' });
    text(ctx, d.url.replace(/^https?:\/\//, ''), { y: 1390, size: 46, color: C.amber, alpha: a(3.3), x: W / 2, align: 'center', weight: 700 });
    if (d.challenge) text(ctx, 'وتقدر تجرب الشهر نفسه وتتحداني', { y: 1500, size: 42, weight: 400, color: C.mute, alpha: a(3.8), x: W / 2, align: 'center' });
  }

  progressBar(ctx, t, plan.total);
  ctx.save(); ctx.font = `400 30px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.textAlign = 'center'; ctx.direction = 'rtl';
  ctx.fillText('NOVA TECH شركة افتراضية · محاكاة تدريبية', W / 2, H - 70); ctx.restore();
}

/** أفضل صيغة يدعمها المتصفح: MP4 إن أمكن (أنسب للنشر)، وإلا WebM. */
export function pickFormat() {
  const types = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const type = typeof MediaRecorder !== 'undefined' ? types.find((x) => MediaRecorder.isTypeSupported(x)) : null;
  return type ? { type, ext: type.startsWith('video/mp4') ? 'mp4' : 'webm' } : null;
}

/** يشغّل الفيديو على اللوحة ويسجله. يعيد Blob. maxSeconds لاختبار قصير. */
export async function record(canvas, d, { onProgress, maxSeconds } = {}) {
  const fmt = pickFormat();
  if (!fmt || !canvas.captureStream) throw new Error('متصفحك لا يدعم تسجيل الفيديو. جرّب Chrome أو Edge أو Safari حديثًا.');
  const plan = scenes(d);
  const total = maxSeconds ? Math.min(maxSeconds, plan.total) : plan.total;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: fmt.type, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => { rec.onstop = r; });
  rec.start(250);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      drawFrame(ctx, d, Math.min(t, total), plan);
      onProgress?.(Math.min(1, t / total));
      if (t >= total) resolve(); else requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((tr) => tr.stop());
  return { blob: new Blob(chunks, { type: fmt.type.split(';')[0] }), ext: fmt.ext };
}

/** معاينة متكررة على اللوحة دون تسجيل. تعيد دالة إيقاف. */
export function preview(canvas, d) {
  const ctx = canvas.getContext('2d');
  const plan = scenes(d);
  const t0 = performance.now();
  let stop = false;
  const tick = () => {
    if (stop) return;
    drawFrame(ctx, d, ((performance.now() - t0) / 1000) % plan.total, plan);
    requestAnimationFrame(tick);
  };
  tick();
  return () => { stop = true; };
}
