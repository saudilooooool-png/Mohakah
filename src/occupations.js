// ربط وظائف محاكي بالتصنيف السعودي الموحد للمهن.
// بنية الرمز (دليل الهيئة العامة للإحصاء 2025): ستة أرقام، الأربعة الأولى هي المجموعة
// الأولية في ISCO-08، والرقمان الأخيران هما المهنة داخلها.

export const STATUS_LABEL = {
  official: 'رمز رسمي',
  candidate: 'رمز مرشح بانتظار التحقق الرسمي',
};

export const MATCH_LABEL = {
  exact: 'مطابق للمسمى',
  closest: 'الأقرب بحسب المهام الرسمية',
};

export const isValidCode = (code) => /^\d{6}$/.test(String(code ?? ''));
export const unitGroupOf = (code) => String(code).slice(0, 4);

/**
 * يعيد وصف وظيفة جاهزًا للعرض: الرمز وحالة التحقق ومدى المطابقة والمصدر، وملف المهنة الرسمي
 * (المهام والجدارات) إن توفر في data.profiles، وربط كل جدارة رسمية بمهارة يقيسها محاكي.
 */
export function roleOccupation(data, roleId) {
  const role = data?.roles?.find((r) => r.id === roleId);
  if (!role) return null;
  const source = (id) => data.sources.find((s) => s.id === id) ?? null;
  const s = role.ssco;
  const saudization = role.saudization ? data.saudization.find((x) => x.id === role.saudization) : null;
  return {
    roleId: role.id,
    roleTitleAr: role.titleAr,
    status: s.status,
    statusLabel: STATUS_LABEL[s.status],
    match: s.match ?? null,
    matchLabel: MATCH_LABEL[s.match] ?? null,
    matchReason: role.matchReason ?? null,
    profile: (s.code && data.profiles?.[s.code]) || null,
    competencyEvidence: role.competencyEvidence ?? null,
    code: s.code ?? null,
    titleAr: s.titleAr ?? null,
    unitGroup: s.unitGroup,
    unitGroupTitle: data.unitGroups[s.unitGroup] ?? null,
    source: source(s.sourceId),
    note: role.note ?? null,
    alternatives: (role.alternatives ?? []).map((a) => ({ ...a, source: source(a.sourceId) })),
    saudization: saudization && { ...saudization, source: source(saudization.sourceId) },
  };
}

/** يتحقق من اتساق بيانات الربط. يعيد قائمة بالمشكلات (فارغة إذا كانت سليمة). */
export function validateOccupationData(data, { scenarioIds = [] } = {}) {
  const problems = [];
  const sources = new Map(data.sources.map((s) => [s.id, s]));
  const official = new Map(data.officialCodes.map((c) => [c.code, c]));

  for (const c of data.officialCodes) {
    if (!isValidCode(c.code)) problems.push(`رمز رسمي بصيغة خاطئة: ${c.code}`);
    if (!sources.get(c.sourceId)?.official) problems.push(`الرمز ${c.code} مصدره ليس رسميًا`);
    // إذا توفرت ملفات المهن من الجدول الرئيسي، يجب أن يوجد كل رمز رسمي فيه بالمسمى نفسه
    if (data.profiles) {
      const p = data.profiles[c.code];
      if (!p) problems.push(`الرمز ${c.code} غير موجود في الجدول الرئيسي`);
      else if (p.titleAr !== c.titleAr) problems.push(`الرمز ${c.code}: المسمى في الجدول الرئيسي «${p.titleAr}»`);
    }
  }

  const checkRef = (where, ref) => {
    if (ref.code != null && !isValidCode(ref.code)) problems.push(`${where}: صيغة الرمز ${ref.code} خاطئة`);
    if (ref.code != null && unitGroupOf(ref.code) !== ref.unitGroup) problems.push(`${where}: الرمز ${ref.code} لا يقع في المجموعة ${ref.unitGroup}`);
    if (!data.unitGroups[ref.unitGroup]) problems.push(`${where}: المجموعة ${ref.unitGroup} غير معرّفة`);
    if (!sources.has(ref.sourceId)) problems.push(`${where}: مصدر غير معروف ${ref.sourceId}`);
  };

  for (const r of data.roles) {
    const s = r.ssco;
    checkRef(r.id, s);
    if (s.status === 'official') {
      // الرمز الرسمي يجب أن يأتي من قائمة الرموز المستخرجة من وثيقة رسمية، وباسمها نفسه
      const o = official.get(s.code);
      if (!o) problems.push(`${r.id}: الرمز ${s.code} موسوم رسميًا لكنه ليس في قائمة الرموز الرسمية`);
      else if (o.titleAr !== s.titleAr) problems.push(`${r.id}: مسمى ${s.code} لا يطابق الوثيقة الرسمية`);
      if (!sources.get(s.sourceId)?.official) problems.push(`${r.id}: موسوم رسميًا ومصدره غير رسمي`);
      if (!MATCH_LABEL[s.match]) problems.push(`${r.id}: مدى المطابقة غير محدد`);
      if (s.match === 'closest' && !r.matchReason) problems.push(`${r.id}: «الأقرب» يحتاج تبريرًا بالمهام`);
    } else if (s.status === 'candidate') {
      if (s.code && official.has(s.code)) problems.push(`${r.id}: الرمز ${s.code} رسمي لكنه موسوم مرشحًا`);
    } else {
      problems.push(`${r.id}: حالة تحقق غير معروفة ${s.status}`);
    }
    for (const a of r.alternatives ?? []) {
      checkRef(`${r.id} (بديل)`, a);
      if (a.code && !official.has(a.code)) problems.push(`${r.id}: البديل ${a.code} ليس رمزًا رسميًا`);
    }
    if (r.saudization && !data.saudization.some((x) => x.id === r.saudization)) problems.push(`${r.id}: قرار توطين غير معروف`);
    if (r.competencyEvidence && data.profiles?.[s.code]) {
      const official = data.profiles[s.code].behavioralCompetencies;
      for (const k of Object.keys(r.competencyEvidence)) if (!official.includes(k)) problems.push(`${r.id}: «${k}» ليست من جدارات المهنة الرسمية`);
    }
    for (const sc of r.scenarios ?? []) if (scenarioIds.length && !scenarioIds.includes(sc)) problems.push(`${r.id}: سيناريو غير موجود ${sc}`);
  }
  return problems;
}
