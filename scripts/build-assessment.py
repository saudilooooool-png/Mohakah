# يبني سيناريو جلسة التقييم القصيرة للشركات (3 أيام عمل مكثفة، نحو ساعتين) من أحداث السيناريو الكامل.
# الاستخدام: python3 scripts/build-assessment.py
import json, copy
src = json.load(open('data/scenarios/pm-first-30-days.json'))
ev = {e['id']: e for e in src['events']}
PLAN = [  # (المعرّف، اليوم)
    ('d1_ufuq_complaint', 1), ('d1_usage_report', 1), ('d1_sales_request', 1),
    ('d3_sprint_priority', 2), ('d7_delegation', 2), ('d6_competitor_price', 2),
    ('d5_mgmt_meeting', 3), ('d23_feedback_1on1', 3), ('d25_outage', 3),
]
events = [{
    "id": "a_brief", "day": 1, "type": "message", "from": "cpo", "priority": "normal", "dueInDays": 1, "skills": ["communication"],
    "title": "FYA: موجز سريع قبل أن تبدأ",
    "body": "أهلًا بك. أمامك ثلاثة أيام عمل مكثفة مديرًا للمنتجات في NOVA TECH. PFA دليل الشركة: المنتج، والعملاء، والمؤشرات. اقرأه أولًا (5 دقائق)، ثم ابدأ ببريدك. تستطيع سؤال أي زميل من صفحة «فريقي».",
    "attachments": ["handbook", "glossary"],
    "options": [{"id": "read", "label": "قرأت الموجز", "quality": 0.85, "effects": [{"op": "trust", "who": "cpo", "value": 2}]}],
}]
for eid, day in PLAN:
    e = copy.deepcopy(ev[eid])
    e['day'] = day
    e['dueInDays'] = 1  # كل بند يُنجز في يومه: جلسة مكثفة
    e.pop('delegable', None)
    events.append(e)
out = {
    "id": "pm-assessment", "derivedFrom": src['id'],
    "company": src['company'], "role": "Product Manager — جلسة تقييم", "roleId": src['roleId'],
    "manager": src['manager'], "team": ["ux", "eng_lead", "dev2", "analyst"],
    "lengthDays": 3, "randomEventChance": 0, "initialTrust": src['initialTrust'],
    "events": events, "randomEvents": [], "insights": [], "memos": [],
}
json.dump(out, open('data/scenarios/pm-assessment.json', 'w'), ensure_ascii=False, indent=1)
print(len(events), 'events')
