import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, loadCompany, loadScenario, loadOccupations, roleOccupation, validateOccupationData, isValidCode } from '../src/index.js';

const data = loadOccupations();
const scenario = loadScenario('pm-first-30-days');

test('بيانات الربط متسقة: الصيغة والمجموعات والمصادر وحالات التحقق', () => {
  assert.deepEqual(validateOccupationData(data, { scenarioIds: [scenario.id] }), []);
});

test('بنية الرمز: ستة أرقام، والأربعة الأولى هي المجموعة الأولية', () => {
  assert.ok(isValidCode('243110'));
  assert.ok(!isValidCode('24311'));
  assert.ok(!isValidCode('1214021'));
  for (const c of data.officialCodes) assert.ok(isValidCode(c.code), c.code);
});

test('الرموز الرسمية المستخرجة من أدلة الوزارة', () => {
  const byCode = Object.fromEntries(data.officialCodes.map((c) => [c.code, c.titleAr]));
  assert.equal(byCode['122103'], 'مدير تسويق');
  assert.equal(byCode['122104'], 'مدير مبيعات');
  assert.equal(byCode['243110'], 'أخصائي تسويق');
  assert.equal(byCode['332201'], 'مندوب مبيعات');
  assert.equal(byCode['242108'], 'أخصائي إدارة مشاريع');
});

test('التحقق يكشف رمزًا موسومًا رسميًا دون مصدر رسمي أو خارج مجموعته', () => {
  const broken = structuredClone(data);
  const pm = broken.roles.find((r) => r.id === 'product-manager');
  pm.ssco.code = '122399'; pm.ssco.titleAr = 'مهنة غير موجودة';
  const ba = broken.roles.find((r) => r.id === 'business-analyst');
  ba.ssco.code = '243110';
  const problems = validateOccupationData(broken);
  assert.ok(problems.some((p) => p.startsWith('product-manager') && p.includes('ليس في قائمة الرموز الرسمية')));
  broken.officialCodes.push({ code: '999999', titleAr: 'وهمي', sourceId: 'gastat-master-2024' });
  assert.ok(validateOccupationData(broken).some((p) => p.includes('999999') && p.includes('غير موجود في الجدول الرئيسي')));
  assert.ok(problems.some((p) => p.startsWith('business-analyst') && p.includes('لا يقع في المجموعة')));
});

test('كل وظائف الـMVP الخمس مربوطة، والمرشح لا يُعرض رسميًا', () => {
  const ids = ['product-manager', 'business-analyst', 'digital-marketing-specialist', 'sales-executive', 'project-manager'];
  for (const id of ids) assert.ok(roleOccupation(data, id), id);
  for (const id of ids) assert.equal(roleOccupation(data, id).status, 'official', id);
  assert.equal(roleOccupation(data, 'product-manager').code, '122302');
  assert.equal(roleOccupation(data, 'business-analyst').code, '251102');
  assert.equal(roleOccupation(data, 'project-manager').saudization.rate, 0.7);
  assert.equal(roleOccupation(data, 'sales-executive').code, '243401');
});

test('السجل المهني يتضمن الوظيفة وفق التصنيف السعودي مع حالتها', () => {
  const sim = new Simulation({ company: loadCompany('nova-tech'), scenario, seed: 2, occupations: data });
  sim.endDay();
  const r = sim.report();
  assert.equal(r.occupation.roleId, 'product-manager');
  assert.equal(r.occupation.statusLabel, 'رمز رسمي');
  assert.equal(r.occupation.matchLabel, 'الأقرب بحسب المهام الرسمية');
  assert.equal(r.occupation.unitGroup, '1223');
  assert.ok(r.occupation.profile.tasks.length >= 3, 'المهام الرسمية من الجدول الرئيسي');
  assert.deepEqual(Object.keys(r.occupation.competencyEvidence), r.occupation.profile.behavioralCompetencies);
});

test('رموز موظفي NOVA TECH (إن وُجدت) رسمية', () => {
  const official = new Set(data.officialCodes.map((c) => c.code));
  for (const p of loadCompany('nova-tech').people.filter((x) => x.occupationCode)) assert.ok(official.has(p.occupationCode), p.id);
});

test('ملفات المهن مستخرجة من الجدول الرئيسي الرسمي (نسخة 2024)', () => {
  assert.ok(Object.keys(data.profiles).length >= 27);
  assert.equal(data.profiles['251102'].titleAr, 'محلل نظم المعلومات');
  assert.equal(data.profiles['251102'].unitGroup, '2511');
  assert.ok(data.profiles['122302'].behavioralCompetencies.includes('اتخاذ القرار'));
});
