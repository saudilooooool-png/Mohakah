import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/plan.js';

test('الخطة: تبدأ من الهدف، والخطوة التالية أول بند يمكن فعله الآن', () => {
  const p0 = buildPlan({ days: 0, lengthDays: 30 });
  assert.equal(p0.readiness, 0);
  assert.equal(p0.next.id, 'goal');
  const p1 = buildPlan({ days: 2, lengthDays: 30, points: 600, goal: { role: 'sales' }, emailVerified: true, weakest: { label: 'التواصل', score: 40 } });
  assert.equal(p1.next.id, 'week1');
  assert.ok(p1.readiness > 0 && p1.readiness < 30);
  // لا يُقترح إصدار السجل قبل إكمال الشهر
  const p2 = buildPlan({ days: 12, lengthDays: 30, points: 760, goal: { role: 'pm' }, emailVerified: true, weakest: { label: 'الوقت', score: 70 } });
  assert.equal(p2.next.id, 'month');
});

test('المؤشر: أوزان مجموعها 100، ويكتمل بالإنجاز والتوثيق والتطبيق والظهور', () => {
  const full = buildPlan({ days: 30, lengthDays: 30, finished: true, points: 900, weakest: { label: 'x', score: 80 }, hasRecord: true, emailVerified: true,
    profile: { summary: 'a', education: 'b', skills: 'c' }, portfolioPublished: true, realWork: 1, market: 1, sharing: true, videoMade: true, goal: { role: 'pm' } });
  assert.equal(full.breakdown.reduce((s, b) => s + b.weight, 0), 100);
  assert.equal(full.readiness, 100);
  assert.equal(full.next, null);
  const mid = buildPlan({ days: 30, lengthDays: 30, finished: true, points: 720, weakest: { label: 'x', score: 60 }, emailVerified: true, goal: { role: 'pm' } });
  assert.equal(mid.next.id, 'record');
  assert.ok(mid.readiness >= 55 && mid.readiness < 70);
});
