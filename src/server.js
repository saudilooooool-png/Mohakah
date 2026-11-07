// خادم محاكي: ملفات الواجهة الثابتة + واجهة الوكلاء.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createAgentApi } from './agents/server.js';
import { createAccountsApi } from './accounts/api.js';
import { FileStore } from './accounts/store.js';

function loadWorld(root) {
  const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  return {
    company: read('data/companies/nova-tech.json'),
    scenario: read('data/scenarios/pm-first-30-days.json'),
    occupations: { ...read('data/occupations/ssco.json'), profiles: read('data/occupations/ssco-profiles.json').profiles },
  };
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

export function createMohakiServer({
  root,
  agentApi = createAgentApi({ root }),
  accountsApi = createAccountsApi({ store: new FileStore(process.env.MOHAKI_DATA_DIR || join(root, '.data')), world: loadWorld(root) }),
}) {
  return createServer(async (req, res) => {
    if (req.url.startsWith('/api/') && (await agentApi(req, res) || await accountsApi(req, res))) return;
    if (req.url.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end('{"error":"غير موجود"}'); }
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') { res.writeHead(302, { Location: '/app/' }); return res.end(); }
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || /[\\/](\.git|\.env|\.data|node_modules)/.test(file)) { res.writeHead(403); return res.end(); }
    try {
      const s = await stat(file);
      const target = s.isDirectory() ? join(file, 'index.html') : file;
      const body = await readFile(target);
      res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('غير موجود');
    }
  });
}
