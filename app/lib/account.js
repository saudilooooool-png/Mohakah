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
