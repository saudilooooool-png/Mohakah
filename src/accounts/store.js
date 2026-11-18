// مخزن بيانات بسيط بملفات JSON (للتجربة المغلقة). يُستبدل بقاعدة بيانات (مثل Postgres)
// قبل الإطلاق العام. الكتابة ذرية (ملف مؤقت ثم إعادة تسمية) حتى لا يتلف الملف عند الانقطاع.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class FileStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(join(dir, 'progress'), { recursive: true });
    this.users = this._read('users.json', {});
    this.sessions = this._read('sessions.json', {});
    this.records = this._read('records.json', {});
    this.tokens = this._read('tokens.json', {});
    // المجتمع: تصحيحات المُيسِّر، والجلسات الحية ونتائجها، ومراجعات الأقران
    this.community = { reviews: {}, sessions: {}, liveResults: {}, peer: {}, ...this._read('community.json', {}) };
    // العرض: روابط التحدي وملفات الأعمال العامة
    this.showcase = { challenges: {}, portfolios: {}, ...this._read('showcase.json', {}) };
    // موقع التسويق: طلبات العروض وعدّاد الزيارات
    this.leads = { requests: [], hits: {}, ...this._read('leads.json', {}) };
    // العمل مع زملاء حقيقيين ودوري الفرق
    this.teams = { pairs: {}, queue: [], leagues: {}, ...this._read('teams.json', {}) };
    // مكتبة الأعمال الواقعية: الفرص والطلبات
    this.work = { gigs: {}, apps: {}, ...this._read('work.json', {}) };
    // جلسات التقييم القصيرة للشركات
    this.assess = { assessments: {}, ...this._read('assess.json', {}) };
    // بحث السوق الحقيقي بتطابق الإجابات
    this.market = { questions: {}, answers: {}, ...this._read('market.json', {}) };
  }

  _read(name, fallback) {
    const f = join(this.dir, name);
    if (!existsSync(f)) return fallback;
    try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; }
  }

  _write(name, data) {
    const f = join(this.dir, name);
    writeFileSync(`${f}.tmp`, JSON.stringify(data));
    renameSync(`${f}.tmp`, f);
  }

  saveUsers() { this._write('users.json', this.users); }
  saveSessions() { this._write('sessions.json', this.sessions); }
  saveRecords() { this._write('records.json', this.records); }
  saveTokens() { this._write('tokens.json', this.tokens); }
  saveCommunity() { this._write('community.json', this.community); }
  saveShowcase() { this._write('showcase.json', this.showcase); }
  saveLeads() { this._write('leads.json', this.leads); }
  saveTeams() { this._write('teams.json', this.teams); }
  saveWork() { this._write('work.json', this.work); }
  saveAssess() { this._write('assess.json', this.assess); }
  saveMarket() { this._write('market.json', this.market); }
  /** كل ملفات التقدم: [userId, progress] */
  allProgress() {
    return readdirSync(join(this.dir, 'progress')).filter((f) => f.endsWith('.json'))
      .map((f) => [f.slice(0, -5), this.progress(f.slice(0, -5))]).filter(([, p]) => p);
  }

  progress(userId) { return this._read(join('progress', `${userId}.json`), null); }
  saveProgress(userId, data) { this._write(join('progress', `${userId}.json`), data); }
  deleteProgress(userId) { rmSync(join(this.dir, 'progress', `${userId}.json`), { force: true }); }
}
