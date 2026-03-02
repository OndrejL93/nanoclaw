import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import { ASSISTANT_NAME, DASHBOARD_PORT } from './config.js';
import {
  getAllRegisteredGroups,
  getRecentMessages,
  storeMessageDirect,
} from './db.js';
import { readEnvFile } from './env.js';
import { isValidGroupFolder, resolveGroupFolderPath } from './group-folder.js';
import { GroupQueue } from './group-queue.js';
import { logger } from './logger.js';

// HTML lives in src/ alongside this file; resolve from project root so it
// works whether running from dist/ (compiled) or src/ (ts-node / tsx).
const __file = fileURLToPath(import.meta.url);
const __dir = path.dirname(__file);
// If compiled output is in dist/, go up one level to find src/dashboard.html
const htmlDir = __dir.endsWith('/dist') || __dir.endsWith('\\dist')
  ? path.join(__dir, '..', 'src')
  : __dir;

function readBody(req: http.IncomingMessage, maxBytes = 512 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function checkAuth(req: http.IncomingMessage, secret: string): boolean {
  const auth = req.headers['authorization'] || '';
  return auth === `Bearer ${secret}`;
}

export function startDashboard(queue: GroupQueue): void {
  const env = readEnvFile(['DASHBOARD_SECRET']);
  const secret = process.env.DASHBOARD_SECRET || env.DASHBOARD_SECRET;

  if (!secret) {
    logger.info('DASHBOARD_SECRET not set — web dashboard disabled');
    return;
  }

  const htmlPath = path.join(htmlDir, 'dashboard.html');

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    // Serve HTML without auth
    if (method === 'GET' && pathname === '/') {
      try {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch {
        res.writeHead(500);
        res.end('Dashboard UI not found');
      }
      return;
    }

    // All /api/* routes require auth
    if (pathname.startsWith('/api/')) {
      if (!checkAuth(req, secret)) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

      // GET /api/status
      if (method === 'GET' && pathname === '/api/status') {
        const registered = getAllRegisteredGroups();
        const liveStatus = queue.getStatus();

        const groups = Object.entries(registered).map(([jid, group]) => {
          const live = liveStatus.get(jid);
          return {
            jid,
            name: group.name,
            folder: group.folder,
            requiresTrigger: group.requiresTrigger !== false,
            active: live?.active ?? false,
            idleWaiting: live?.idleWaiting ?? false,
            containerName: live?.containerName ?? null,
            isTaskContainer: live?.isTaskContainer ?? false,
          };
        });

        json(res, 200, { assistantName: ASSISTANT_NAME, groups });
        return;
      }

      // GET /api/messages?jid=&limit=
      if (method === 'GET' && pathname === '/api/messages') {
        const jid = url.searchParams.get('jid') || '';
        const limit = Math.min(
          500,
          Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50),
        );

        const registered = getAllRegisteredGroups();
        if (!jid || !registered[jid]) {
          json(res, 404, { error: 'Group not found' });
          return;
        }

        const messages = getRecentMessages(jid, limit);
        json(res, 200, { messages });
        return;
      }

      // POST /api/send
      if (method === 'POST' && pathname === '/api/send') {
        let body: { jid?: string; text?: string };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: 'Invalid JSON body' });
          return;
        }

        const { jid, text } = body;
        if (!jid || !text || typeof jid !== 'string' || typeof text !== 'string') {
          json(res, 400, { error: 'Missing jid or text' });
          return;
        }

        const registered = getAllRegisteredGroups();
        if (!registered[jid]) {
          json(res, 404, { error: 'Group not found' });
          return;
        }

        const id = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        storeMessageDirect({
          id,
          chat_jid: jid,
          sender: 'dashboard',
          sender_name: 'Dashboard',
          content: text,
          timestamp: new Date().toISOString(),
          is_from_me: false,
          is_bot_message: false,
        });

        queue.enqueueMessageCheck(jid);
        json(res, 200, { ok: true });
        return;
      }

      // GET /api/claude-md?folder=
      if (method === 'GET' && pathname === '/api/claude-md') {
        const folder = url.searchParams.get('folder') || '';
        if (!folder || !isValidGroupFolder(folder)) {
          json(res, 400, { error: 'Invalid folder' });
          return;
        }

        try {
          const groupPath = resolveGroupFolderPath(folder);
          const claudeMdPath = path.join(groupPath, 'CLAUDE.md');
          const content = fs.existsSync(claudeMdPath)
            ? fs.readFileSync(claudeMdPath, 'utf-8')
            : '';
          json(res, 200, { content });
        } catch (err) {
          json(res, 400, { error: String(err) });
        }
        return;
      }

      // PUT /api/claude-md?folder=
      if (method === 'PUT' && pathname === '/api/claude-md') {
        const folder = url.searchParams.get('folder') || '';
        if (!folder || !isValidGroupFolder(folder)) {
          json(res, 400, { error: 'Invalid folder' });
          return;
        }

        let body: { content?: string };
        try {
          body = JSON.parse(await readBody(req));
        } catch {
          json(res, 400, { error: 'Invalid JSON body' });
          return;
        }

        if (typeof body.content !== 'string') {
          json(res, 400, { error: 'Missing content' });
          return;
        }

        try {
          const groupPath = resolveGroupFolderPath(folder);
          fs.mkdirSync(groupPath, { recursive: true });
          fs.writeFileSync(path.join(groupPath, 'CLAUDE.md'), body.content, 'utf-8');
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 400, { error: String(err) });
        }
        return;
      }

      json(res, 404, { error: 'Not found' });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.on('error', (err) => {
    logger.error({ err }, 'Dashboard server error');
  });

  server.listen(DASHBOARD_PORT, () => {
    logger.info({ port: DASHBOARD_PORT }, 'Dashboard listening');
  });
}
