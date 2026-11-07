// منطق الاجتماع الحواري — كود نقي يعمل في المتصفح والخادم.
//
// تقسيم المسؤوليات:
// - الوكيل (Claude أو الوضع المحلي) يكتب ردود المشاركين، ويحكم أي الاعتراضات أُجيبت،
//   ويختار عند الختام إحدى النتائج المسموح بها في السيناريو فقط.
// - هذا الملف يتحقق من كل ما يعيده الوكيل قبل قبوله.
// - المحرك وحده يطبّق الآثار (آثار الخيار + آثار الاعتراضات المُجابة كما يحددها السيناريو).

const normalize = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[إأآا]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[ً-ْ]/g, '');

export const MAX_MESSAGE_CHARS = 1500;

export function openMeeting(item) {
  const spec = item.dialogue;
  if (!spec) throw new Error('هذا البند ليس اجتماعًا حواريًا');
  return {
    itemId: item.id,
    eventId: item.eventId,
    round: 0,
    maxRounds: spec.maxRounds ?? 3,
    transcript: spec.opening.map((l) => ({ speaker: l.speaker, text: l.text })),
    addressed: Object.fromEntries(spec.concerns.map((c) => [c.id, false])),
    stance: 'unclear',
    closed: false,
    decision: null,
    mode: null,
  };
}

export const canClose = (meeting) => meeting.round >= 1 && !meeting.closed;
export const mustClose = (meeting) => meeting.round >= meeting.maxRounds && !meeting.closed;

// ——— مخطط الرد المطلوب من النموذج ———

export function turnSchema(spec, optionIds, { closing = false } = {}) {
  const concerns = {
    type: 'object',
    properties: Object.fromEntries(spec.concerns.map((c) => [c.id, { type: 'boolean' }])),
    required: spec.concerns.map((c) => c.id),
    additionalProperties: false,
  };
  const replies = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        speaker: { type: 'string', enum: spec.participants },
        text: { type: 'string' },
      },
      required: ['speaker', 'text'],
      additionalProperties: false,
    },
  };
  if (closing) {
    return {
      type: 'object',
      properties: { replies, concerns, decision: { type: 'string', enum: optionIds } },
      required: ['replies', 'concerns', 'decision'],
      additionalProperties: false,
    };
  }
  return {
    type: 'object',
    properties: {
      replies,
      concerns,
      stance: { type: 'string', enum: [...optionIds, 'unclear'] },
    },
    required: ['replies', 'concerns', 'stance'],
    additionalProperties: false,
  };
}

/** يتحقق من رد الوكيل ويقصّه إلى حدود آمنة. يرمي خطأ إذا كان غير صالح. */
export function sanitizeTurn(spec, optionIds, raw, { closing = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('رد الوكيل ليس كائنًا');
  const replies = (Array.isArray(raw.replies) ? raw.replies : [])
    .filter((r) => r && spec.participants.includes(r.speaker) && typeof r.text === 'string' && r.text.trim())
    .slice(0, 4)
    .map((r) => ({ speaker: r.speaker, text: r.text.trim().slice(0, 600) }));
  if (!replies.length) throw new Error('رد الوكيل بلا ردود صالحة');
  const concerns = {};
  for (const c of spec.concerns) {
    if (typeof raw.concerns?.[c.id] !== 'boolean') throw new Error(`حكم الاعتراض ${c.id} مفقود`);
    concerns[c.id] = raw.concerns[c.id];
  }
  if (closing) {
    if (!optionIds.includes(raw.decision)) throw new Error(`قرار غير مسموح: ${raw.decision}`);
    return { replies, concerns, decision: raw.decision };
  }
  const stance = [...optionIds, 'unclear'].includes(raw.stance) ? raw.stance : 'unclear';
  return { replies, concerns, stance };
}

/** يضيف رسالة المتدرب ورد الوكيل إلى الاجتماع (دون تعديل الكائن الأصلي). */
export function applyTurn(meeting, message, turn, { closing = false, mode } = {}) {
  const m = structuredClone(meeting);
  if (message) m.transcript.push({ speaker: 'trainee', text: message });
  m.transcript.push(...turn.replies);
  // الاعتراض الذي أُجيب يبقى مُجابًا
  for (const [id, v] of Object.entries(turn.concerns)) m.addressed[id] = m.addressed[id] || v;
  if (message) m.round += 1;
  if (turn.stance) m.stance = turn.stance;
  if (mode) m.mode = m.mode && m.mode !== mode ? 'mixed' : mode;
  if (closing) {
    m.closed = true;
    m.decision = turn.decision;
  }
  return m;
}

/** ما يُرسل إلى المحرك عند انتهاء الاجتماع. */
export function meetingResult(meeting) {
  if (!meeting.closed) throw new Error('الاجتماع لم يُختتم بعد');
  const said = meeting.transcript.filter((l) => l.speaker === 'trainee').map((l) => l.text);
  return {
    optionId: meeting.decision,
    rationale: said.join('\n'),
    transcript: meeting.transcript,
    addressed: Object.entries(meeting.addressed).filter(([, v]) => v).map(([k]) => k),
    mode: meeting.mode,
  };
}

// ——— الوضع المحلي: وكيل قائم على القواعد (دون نموذج لغوي) ———

function detectConcerns(spec, text) {
  const body = normalize(text);
  return Object.fromEntries(spec.concerns.map((c) => {
    const hits = c.keywords.filter((k) => body.includes(normalize(k))).length;
    return [c.id, hits >= (c.minHits ?? 1)];
  }));
}

function detectStance(spec, text) {
  const body = normalize(text);
  for (const [stance, words] of Object.entries(spec.stanceKeywords ?? {})) {
    if (words.some((w) => body.includes(normalize(w)))) return stance;
  }
  return null;
}

export function offlineTurn(spec, meeting, message) {
  const found = detectConcerns(spec, message);
  const replies = [];
  for (const c of spec.concerns) {
    if (found[c.id] && !meeting.addressed[c.id]) replies.push({ speaker: c.owner, text: c.replyAddressed });
  }
  const stillOpen = spec.concerns.filter((c) => !found[c.id] && !meeting.addressed[c.id]);
  if (stillOpen.length) replies.push({ speaker: stillOpen[0].owner, text: stillOpen[0].replyOpen });
  if (!replies.length) replies.push({ speaker: spec.chair, text: 'واضح. هل هناك ما تضيفه قبل أن نختم؟' });
  const addressedCount = spec.concerns.filter((c) => found[c.id] || meeting.addressed[c.id]).length;
  const stance = detectStance(spec, message) ?? (addressedCount >= 2 ? 'defend_with_data' : 'unclear');
  return { replies: replies.slice(0, 3), concerns: found, stance };
}

export function offlineClose(spec, meeting) {
  const addressedCount = Object.values(meeting.addressed).filter(Boolean).length;
  let decision;
  if (meeting.stance === 'cut_scope' || meeting.stance === 'give_in') decision = meeting.stance;
  else decision = addressedCount >= 2 ? 'defend_with_data' : 'give_in';
  return {
    replies: [{ speaker: spec.chair, text: spec.outcomes[decision]?.closing ?? 'شكرًا، انتهى الاجتماع.' }],
    concerns: { ...meeting.addressed },
    decision,
  };
}
