// موقع محاكي: إرسال طلب العرض، وعدّاد زيارات دون كوكيز، وقائمة الجوال.
(function () {
  const page = document.body.dataset.offer;
  // عدّاد الزيارات: صفحة واحدة لكل زيارة، دون أي معرّف للزائر
  try { fetch('/api/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }), keepalive: true }); } catch { /* */ }

  const btn = document.querySelector('.menu-btn');
  const nav = document.querySelector('.nav');
  btn?.addEventListener('click', () => { nav.classList.toggle('open'); btn.setAttribute('aria-expanded', nav.classList.contains('open')); });

  const form = document.querySelector('form.lead');
  if (!form) return;
  const msg = form.querySelector('.form-msg');
  const src = new URLSearchParams(location.search);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = Object.fromEntries(f.entries());
    body.consent = f.get('consent') === 'on';
    body.offer = page;
    body.source = [src.get('utm_source'), src.get('utm_campaign')].filter(Boolean).join(' / ') || document.referrer.slice(0, 120);
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    msg.hidden = false; msg.className = 'form-msg'; msg.textContent = 'جارٍ الإرسال…';
    try {
      const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'تعذر الإرسال');
      form.reset();
      msg.className = 'form-msg ok';
      msg.textContent = 'شكرًا! وصلنا طلبك، وسنتواصل معك خلال يومي عمل لترتيب التجربة.';
    } catch (err) {
      msg.className = 'form-msg bad';
      msg.textContent = err.message;
    } finally { submit.disabled = false; }
  });
}());
