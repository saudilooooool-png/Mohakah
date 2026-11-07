// منسّق الاجتماع في المتصفح: Claude عبر الخادم إن كان متاحًا، وإلا الوضع المحلي.
import {
  openMeeting, offlineTurn, offlineClose, sanitizeTurn, applyTurn,
} from '../../src/agents/meeting.js';

let statusPromise = null;
const OFFLINE = { mode: 'offline', routes: { meeting: 'offline', chat: 'offline', colleague: 'offline' } };
/** حالة الوكلاء لهذا المستخدم: لكل مسار (اجتماع، محادثة، زميل) Claude أو محلي. */
export function agentStatus() {
  statusPromise ??= fetch('/api/agents/status', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : OFFLINE))
    .catch(() => OFFLINE);
  return statusPromise;
}
/** تتغير الحالة عند الدخول أو الخروج (الضيف يعمل محليًا). */
export function resetAgentStatus() { statusPromise = null; }
export const routeOf = (spec) => (spec?.mode === 'chat' ? 'chat' : 'meeting');

/** لقطة الحالة التي يحتاجها الوكلاء ليتحدثوا عن الشركة بأرقامها الحقيقية. */
export function meetingContext(sim) {
  const d = sim.dashboard();
  const c = sim.state.company;
  return {
    day: d.day,
    mrr: d.mrr,
    customers: d.customers,
    cash: d.cash,
    runwayMonths: d.runwayMonths,
    productQuality: d.productQuality,
    avgHealth: d.avgHealth,
    supportBacklog: d.supportBacklog,
    morale: d.morale,
    keyAccountsActive: d.keyAccountsActive,
    seatPrice: c.pricing.seatPrice,
    marketingBudget: c.marketing.monthlyBudget,
    competitors: d.competitors,
    trust: d.trust,
    roadmap: { active: c.roadmap.active?.title ?? null, queue: d.roadmap.queue, shipped: d.roadmap.shipped },
    features: Object.fromEntries(Object.values(c.features).map((f) => [f.name, Math.round(f.usage)])),
    accountsAtRisk: c.accounts.filter((a) => a.status === 'active' && a.health < 40).map((a) => a.name),
    recentDecisions: sim.items.filter((i) => i.status === 'done' && i.resolution?.optionId)
      .slice(-8).map((i) => `${i.title}: ${i.options.find((o) => o.id === i.resolution.optionId)?.label}`),
  };
}

export { openMeeting };

/**
 * جولة واحدة (أو جولة الختام). يعيد { meeting, fellBack } حيث fellBack يعني أن Claude
 * لم يكن متاحًا فاستُخدم الوضع المحلي لهذه الجولة.
 */
export async function runTurn(sim, item, meeting, message, { closing = false } = {}) {
  const spec = item.dialogue;
  const optionIds = item.options.map((o) => o.id);
  const status = await agentStatus();
  if (status.routes?.[routeOf(spec)] === 'claude') {
    try {
      const res = await fetch('/api/meeting/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: item.eventId,
          context: meetingContext(sim),
          meeting: { transcript: meeting.transcript, addressed: meeting.addressed, round: meeting.round },
          message,
          closing,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // تحقق ثانٍ في المتصفح: لا يدخل المحرك إلا ما يطابق السيناريو
      const turn = sanitizeTurn(spec, optionIds, data, { closing });
      return { meeting: applyTurn(meeting, message, turn, { closing, mode: 'claude' }), fellBack: false };
    } catch (err) {
      console.warn('تعذر استخدام Claude، التحويل إلى الوضع المحلي:', err);
      const turn = closing ? offlineClose(spec, meeting) : offlineTurn(spec, meeting, message);
      return { meeting: applyTurn(meeting, message, turn, { closing, mode: 'offline' }), fellBack: true, error: err.message };
    }
  }
  const turn = closing ? offlineClose(spec, meeting) : offlineTurn(spec, meeting, message);
  return { meeting: applyTurn(meeting, message, turn, { closing, mode: meeting.mode ?? 'offline' }), fellBack: false };
}
