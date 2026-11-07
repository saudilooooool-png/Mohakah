// خادم محاكي: ملفات الواجهة الثابتة + واجهة الوكلاء.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createAgentApi } from './agents/server.js';

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

export function createMohakiServer({ root, agentApi = createAgentApi({ root }) }) {
  return createServer(async (req, res) => {
    if (req.url.startsWith('/api/') && await agentApi(req, res)) return;
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/') { res.writeHead(302, { Location: '/app/' }); return res.end(); }
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || /[\\/](\.git|\.env|node_modules)/.test(file)) { res.writeHead(403); return res.end(); }
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
