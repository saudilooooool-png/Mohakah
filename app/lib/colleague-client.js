// مراسلة الزملاء في المتصفح: Claude عبر الخادم إن كان متاحًا، وإلا الرد المحلي.
import { offlineColleagueReply, sanitizeColleagueReply } from '../../src/agents/colleague.js';
import { agentStatus, meetingContext } from './meeting-client.js';

/** يعيد { reply, mode, fellBack }. */
export async function colleagueReply(session, person, message) {
  const sim = session.sim;
  const ctx = meetingContext(sim);
  // المحادثة السابقة دون الرسالة الحالية (أضيفت للتو إلى السجل)
  const all = session.thread(person.id);
  const thread = all.slice(0, all.length - 1).map((m) => ({ speaker: m.speaker, text: m.text }));
  const status = await agentStatus();
  const offline = () => offlineColleagueReply({ person, people: session.world.company.people, ctx, day: Math.min(sim.day, sim.lastDay), message });
  if (status.routes?.colleague === 'claude') {
    try {
      const res = await fetch('/api/colleague/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId: person.id, context: ctx, thread, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return { ...sanitizeColleagueReply(data), mode: 'claude', fellBack: false };
    } catch (err) {
      console.warn('تعذر استخدام Claude في المراسلة، التحويل إلى الرد المحلي:', err);
      return { reply: offline(), mode: 'offline', fellBack: true };
    }
  }
  return { reply: offline(), mode: 'offline', fellBack: false };
}
