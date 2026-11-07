// إرسال البريد. نوعان:
// - SMTP (الإنتاج): MOHAKI_SMTP_URL مثل smtps://user:pass@email-smtp.me-central-1.amazonaws.com:465
// - صندوق صادر (التطوير والتجربة المغلقة): يحفظ الرسائل في .data/outbox ويطبع الرابط في سجل الخادم.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** قالب بريد عربي بسيط من اليمين لليسار، بنسختين HTML ونص. */
export function renderEmail({ title, greeting, lines, action, note }) {
  const text = [greeting, '', ...lines, '', `${action.label}: ${action.url}`, '', note, '', 'فريق محاكي'].join('\n');
  const html = `<!doctype html><html lang="ar" dir="rtl"><body style="margin:0;background:#F7F8FA;font-family:Tahoma,Arial,sans-serif;color:#0B1F44">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e8ef">
<div style="background:#0B1F44;color:#fff;padding:18px 24px;font-size:18px;font-weight:bold">محاكي <span style="color:#00C2D1;font-size:13px;letter-spacing:2px">MOHAKI</span></div>
<div style="padding:24px;line-height:1.8;font-size:15px">
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
<p>${esc(greeting)}</p>${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
<p style="margin:24px 0"><a href="${esc(action.url)}" style="background:#00C2D1;color:#0B1F44;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">${esc(action.label)}</a></p>
<p style="font-size:13px;color:#7c879c">إذا لم يعمل الزر، انسخ هذا الرابط إلى المتصفح:<br><span dir="ltr" style="word-break:break-all">${esc(action.url)}</span></p>
<p style="font-size:13px;color:#7c879c">${esc(note)}</p>
</div></div></body></html>`;
  return { text, html };
}

export function outboxMailer(dir, { log = console.log } = {}) {
  mkdirSync(dir, { recursive: true });
  return {
    kind: 'outbox',
    async send(msg) {
      const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
      writeFileSync(file, JSON.stringify({ ...msg, at: new Date().toISOString() }, null, 1));
      log(`✉️  [صندوق صادر] إلى ${msg.to}: ${msg.subject}${msg.link ? `\n    ${msg.link}` : ''}`);
    },
  };
}

export async function smtpMailer(url, from) {
  const { default: nodemailer } = await import('nodemailer');
  const transport = nodemailer.createTransport(url);
  return {
    kind: 'smtp',
    async send({ to, subject, text, html }) { await transport.sendMail({ from, to, subject, text, html }); },
  };
}

/** يختار المرسل بحسب الإعدادات. */
export async function createMailer({ env = process.env, dataDir }) {
  if (env.MOHAKI_SMTP_URL) return smtpMailer(env.MOHAKI_SMTP_URL, env.MOHAKI_MAIL_FROM || 'محاكي <no-reply@mohaki.sa>');
  return outboxMailer(join(dataDir, 'outbox'));
}
