// موقع التسويق: طلبات العروض التجريبية من الشركات، وعدّاد زيارات لكل عرض.
//
// الهدف قياس الطلب قبل البناء: أي عرض (يوم العمل التجريبي، تمهير، المديرون الجدد) يجلب طلبات أكثر؟
// العدّاد لا يستخدم كوكيز ولا يحفظ عناوين IP: عدد زيارات يومي لكل صفحة فقط.
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../accounts/api.js';

export const OFFERS = {
  assessment: 'يوم عمل تجريبي بدل المقابلة',
  tamheer: 'برنامج جاهز لمتدربي تمهير',
  managers: 'جاهزية المدير الجديد',
};
const str = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const now = () => new Date().toISOString();

export function createLeadsApi({ store, mailer, env = process.env, clock = now }) {
  store.leads ??= { requests: [], hits: {} };
  const L = store.leads;
  const save = () => store.saveLeads?.();
  const recent = new Map(); // حد بسيط للإرسال لكل عنوان: 5 طلبات في الساعة (في الذاكرة فقط)

  function limited(req) {
    const ip = String(req.headers?.['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
    const t = Date.now();
    const list = (recent.get(ip) ?? []).filter((x) => t - x < 3600e3);
    if (list.length >= 5) return true;
    list.push(t); recent.set(ip, list);
    return false;
  }

  async function createLead(req, body) {
    if (str(body.website)) return { ok: true }; // حقل فخ للبرامج الآلية: نتظاهر بالنجاح
    if (limited(req)) throw new HttpError(429, 'وصلنا عدد كبير من الطلبات منك. حاول بعد قليل، أو راسلنا مباشرة.');
    const offer = OFFERS[body.offer] ? body.offer : 'assessment';
    const lead = {
      id: randomUUID(), offer, at: clock(),
      name: str(body.name, 80), company: str(body.company, 120), title: str(body.title, 80),
      email: str(body.email, 120).toLowerCase(), phone: str(body.phone, 30),
      roles: str(body.roles, 200), volume: str(body.volume, 40), message: str(body.message, 1500),
      source: str(body.source, 120),
    };
    if (lead.name.length < 2) throw new HttpError(400, 'الاسم مطلوب');
    if (lead.company.length < 2) throw new HttpError(400, 'اسم الجهة مطلوب');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) throw new HttpError(400, 'البريد الإلكتروني غير صالح');
    if (body.consent !== true) throw new HttpError(400, 'نحتاج موافقتك على التواصل معك بخصوص طلبك');
    L.requests.push(lead);
    save();
    const to = env.MOHAKI_LEADS_EMAIL;
    if (to && mailer) {
      mailer.send({
        to, subject: `طلب عرض جديد: ${lead.company} (${OFFERS[offer]})`,
        text: [`العرض: ${OFFERS[offer]}`, `الاسم: ${lead.name} — ${lead.title}`, `الجهة: ${lead.company}`, `البريد: ${lead.email}`, `الجوال: ${lead.phone || '—'}`,
          `الأدوار: ${lead.roles || '—'}`, `العدد الشهري: ${lead.volume || '—'}`, '', lead.message].join('\n'),
      }).catch((err) => console.error('تعذر إرسال إشعار الطلب', err.message));
    }
    return { ok: true };
  }

  function hit(body) {
    const page = Object.keys(OFFERS).includes(body.page) ? body.page : null;
    if (!page) return { ok: true };
    const day = clock().slice(0, 10);
    L.hits[day] ??= {};
    L.hits[day][page] = (L.hits[day][page] ?? 0) + 1;
    save();
    return { ok: true };
  }

  function isAdmin(req) {
    const token = env.MOHAKI_ADMIN_TOKEN;
    const got = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token || !got) return false;
    const a = Buffer.from(token); const b = Buffer.from(got);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** لوحة القياس: الزيارات والطلبات ونسبة التحويل لكل عرض. */
  function summary() {
    const by = Object.fromEntries(Object.keys(OFFERS).map((k) => [k, { label: OFFERS[k], visits: 0, requests: 0 }]));
    for (const day of Object.values(L.hits)) for (const [k, n] of Object.entries(day)) by[k].visits += n;
    for (const r of L.requests) by[r.offer].requests += 1;
    for (const v of Object.values(by)) v.conversion = v.visits ? Math.round((v.requests / v.visits) * 1000) / 10 : null;
    return { offers: by, requests: [...L.requests].reverse(), hits: L.hits };
  }

  return async function handle(req, res) {
    const path = new URL(req.url, 'http://x').pathname;
    const routes = {
      'POST /api/leads': (body) => createLead(req, body),
      'POST /api/hit': (body) => hit(body),
      'GET /api/admin/leads': () => { if (!isAdmin(req)) throw new HttpError(401, 'رمز المسؤول مطلوب'); return summary(); },
    };
    const fn = routes[`${req.method} ${path}`];
    if (!fn) return false;
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      let body = {};
      if (req.method === 'POST') {
        if (!String(req.headers?.['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'المحتوى يجب أن يكون JSON');
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new HttpError(413, 'الطلب كبير جدًا'); }
        try { body = JSON.parse(raw || '{}'); } catch { throw new HttpError(400, 'JSON غير صالح'); }
      }
      send(200, await fn(body));
    } catch (err) {
      if (err instanceof HttpError) send(err.status, { error: err.message });
      else { console.error(err); send(500, { error: 'خطأ في الخادم' }); }
    }
    return true;
  };
}
