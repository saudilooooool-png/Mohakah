#!/usr/bin/env python3
"""استيراد ملفات المهن من الجدول الرئيسي للتصنيف السعودي الموحد للمهن.

المصدر: الهيئة العامة للإحصاء — The_Unified_Saudi_Occupational_Classification__Master_Sheets__2024-Ar.xlsx
(صفحة التصانيف: https://www.stats.gov.sa/ar/classifications)

الاستخدام:
    python3 scripts/import-ssco.py path/to/master.xlsx

يقرأ كل الرموز المستخدمة في data/occupations/ssco.json، ويستخرج لكل رمز من الجدول الرسمي:
المسمى والوحدة والملخص والمهام والمؤهل والجدارات، ويكتبها في data/occupations/ssco-profiles.json.
يفشل إذا كان أحد الرموز غير موجود في الجدول أو اختلف مسماه.
يتطلب: openpyxl
"""
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
MAPPING = ROOT / 'data/occupations/ssco.json'
OUT = ROOT / 'data/occupations/ssco-profiles.json'


def clean(v):
    return ' '.join(str(v).split()) if v is not None else None


def main(xlsx):
    ws = openpyxl.load_workbook(xlsx, read_only=True).worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    header = [clean(c) for c in rows[6]]
    assert header[8] == 'رمز المهنة' and header[9] == 'المهنة', f'بنية غير متوقعة للجدول: {header[:10]}'
    edition = clean(rows[5][0])
    table = {}
    for r in rows[7:]:
        if not r[8]:
            continue
        code = clean(r[8])
        table[code] = {
            'code': code,
            'titleAr': clean(r[9]),
            'unitGroup': clean(r[6]),
            'unitGroupTitleAr': clean(r[7]),
            'summary': clean(r[10]),
            'tasks': [clean(t) for t in r[11:16] if t],
            'qualification': clean(r[16]),
            'educationFields': [clean(t) for t in r[17:20] if t],
            'behavioralCompetencies': [clean(t) for t in r[20:25] if t],
            'technicalCompetencies': [clean(t) for t in r[25:30] if t],
        }

    mapping = json.loads(MAPPING.read_text(encoding='utf-8'))
    wanted = {c['code']: c['titleAr'] for c in mapping['officialCodes']}
    for role in mapping['roles']:
        for ref in [role['ssco'], *role.get('alternatives', [])]:
            if ref.get('code'):
                wanted.setdefault(ref['code'], ref.get('titleAr'))

    profiles, problems = {}, []
    for code, title in sorted(wanted.items()):
        p = table.get(code)
        if not p:
            problems.append(f'{code}: غير موجود في الجدول الرسمي')
        elif title and p['titleAr'] != title:
            problems.append(f'{code}: المسمى في الجدول «{p["titleAr"]}» يختلف عن «{title}»')
        else:
            profiles[code] = p
    if problems:
        sys.exit('\n'.join(problems))

    OUT.write_text(json.dumps({
        'source': 'gastat-master-2024',
        'edition': edition,
        'occupationsInTable': len(table),
        'profiles': profiles,
    }, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(profiles)} ملف مهنة من أصل {len(table)} مهنة في الجدول ({edition}) ← {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
