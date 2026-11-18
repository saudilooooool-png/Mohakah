// واجهة الحسابات في المتصفح. الجلسة في ملف تعريف ارتباط HttpOnly يديره الخادم.
async function api(method, path, body, { keepalive = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    keepalive, // يكتمل الطلب حتى لو أُغلقت الصفحة
  });
  let data = {};
  try { data = await res.json(); } catch { /* */ }
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

export const account = {
  me: () => api('GET', '/api/me').then((d) => d.user).catch(() => null),
  register: (body) => api('POST', '/api/auth/register', body),
  login: (email, password) => api('POST', '/api/auth/login', { email, password }),
  logout: () => api('POST', '/api/auth/logout', {}),
  update: (body) => api('PATCH', '/api/me', body),
  remove: () => api('DELETE', '/api/me', {}),
  progress: () => api('GET', '/api/progress').then((d) => d.progress),
  saveProgress: (save, opts) => api('PUT', '/api/progress', save, opts),
  issueRecord: () => api('POST', '/api/records/issue', {}),
  resendVerification: () => api('POST', '/api/auth/verify/send', {}),
  confirmEmail: (token) => api('POST', '/api/auth/verify', { token }),
  requestReset: (email) => api('POST', '/api/auth/reset/request', { email }),
  resetPassword: (token, password) => api('POST', '/api/auth/reset', { token, password }),
  record: (code) => api('GET', `/api/records/${encodeURIComponent(code)}`),
  facDialogues: (filter = 'pending') => api('GET', `/api/facilitator/dialogues?filter=${filter}`).then((d) => d.dialogues),
  facReview: (body) => api('POST', '/api/facilitator/review', body),
  facCalibration: () => api('GET', '/api/facilitator/calibration'),
  liveList: () => api('GET', '/api/live'),
  liveCreate: (body) => api('POST', '/api/live', body),
  live: (id) => api('GET', `/api/live/${encodeURIComponent(id)}`).then((d) => d.session),
  liveSay: (id, body) => api('POST', `/api/live/${encodeURIComponent(id)}/message`, body).then((d) => d.session),
  liveStart: (id) => api('POST', `/api/live/${encodeURIComponent(id)}/start`, {}).then((d) => d.session),
  liveClose: (id, body) => api('POST', `/api/live/${encodeURIComponent(id)}/close`, body).then((d) => d.session),
  liveResults: () => api('GET', '/api/live-results').then((d) => d.results).catch(() => ({})),
  collaboration: () => api('GET', '/api/collaboration').catch(() => null),
  portfolioMe: () => api('GET', '/api/portfolio/me'),
  portfolioSave: (body) => api('PUT', '/api/portfolio/me', body),
  portfolioDelete: () => api('DELETE', '/api/portfolio/me'),
  portfolio: (slug) => api('GET', `/api/portfolio/${encodeURIComponent(slug)}`).then((d) => d.portfolio),
  pairsMine: () => api('GET', '/api/pairs/mine'),
  pairRequest: () => api('POST', '/api/pairs/request', {}),
  pairCancel: () => api('POST', '/api/pairs/cancel', {}),
  pairSay: (id, text) => api('POST', `/api/pairs/${encodeURIComponent(id)}/message`, { text }).then((d) => d.pair),
  leagues: () => api('GET', '/api/leagues').then((d) => d.leagues),
  leagueCreate: (body) => api('POST', '/api/leagues', body).then((d) => d.league),
  league: (id) => api('GET', `/api/leagues/${encodeURIComponent(id)}`).then((d) => d.league),
  work: () => api('GET', '/api/work'),
  workCreate: (body) => api('POST', '/api/work', body).then((d) => d.gig),
  workClose: (id) => api('POST', `/api/work/${encodeURIComponent(id)}/close`, {}),
  workApply: (id, note) => api('POST', `/api/work/${encodeURIComponent(id)}/apply`, { note }),
  workSubmit: (appId, body) => api('POST', `/api/work/apps/${encodeURIComponent(appId)}/submit`, body),
  workWithdraw: (appId) => api('POST', `/api/work/apps/${encodeURIComponent(appId)}/withdraw`, {}),
  workReview: () => api('GET', '/api/work/review').then((d) => d.applications),
  workDecide: (appId, body) => api('POST', `/api/work/apps/${encodeURIComponent(appId)}/decide`, body),
  workSummary: () => api('GET', '/api/work/summary').catch(() => null),
  market: () => api('GET', '/api/market'),
  marketCreate: (body) => api('POST', '/api/market', body),
  marketAnswer: (id, body) => api('POST', `/api/market/${encodeURIComponent(id)}/answer`, body),
  marketConfirm: (id, value) => api('POST', `/api/market/${encodeURIComponent(id)}/confirm`, { value }),
  challengeCreate: () => api('POST', '/api/challenges', {}).then((d) => d.challenge),
  challenge: (code) => api('GET', `/api/challenges/${encodeURIComponent(code)}`).then((d) => d.challenge),
  myChallenge: () => api('GET', '/api/my-challenge').then((d) => d.challenge).catch(() => null),
  challengeRevoke: (code) => api('DELETE', `/api/challenges/${encodeURIComponent(code)}`),
  peerQueue: () => api('GET', '/api/peer/queue').then((d) => d.assignments),
  peerReview: (body) => api('POST', '/api/peer/review', body),
  peerReceived: () => api('GET', '/api/peer/received').then((d) => d.reviews),
  peerFeedback: (body) => api('POST', '/api/peer/feedback', body),
  facPeer: () => api('GET', '/api/facilitator/peer').then((d) => d.reviews),
  facModerate: (body) => api('POST', '/api/facilitator/peer/moderate', body),
};

/** حفظ مؤجل: يجمع التغييرات المتتالية في طلب واحد. */
export function debouncedSaver(delay = 800) {
  let timer = null;
  let pending = null;
  const flush = ({ keepalive = false } = {}) => {
    if (!pending) return Promise.resolve();
    const data = pending; pending = null; clearTimeout(timer); timer = null;
    return account.saveProgress(data, { keepalive }).catch((err) => console.warn('تعذر حفظ التقدم على الخادم', err));
  };
  return {
    save(data) { pending = data; clearTimeout(timer); timer = setTimeout(flush, delay); },
    flush,
  };
}
