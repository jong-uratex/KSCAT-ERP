import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import { createNodeSqliteDatabase } from './server/node_db.ts';
import { createApiRouter } from './server/routes.ts';

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  const nodeDb = createNodeSqliteDatabase();
  await initDatabase(nodeDb);
  const apiRouter = createApiRouter(nodeDb, process.env);

  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );

  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin?.replace(/\/+$/, '');
    if (origin) {
      res.setHeader('Vary', 'Origin');
      if (allowedOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Requested-With'
        );
        res.setHeader('Access-Control-Max-Age', '86400');
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use('/api', async (req, res, next) => {
    try {
      const protocol = req.protocol || 'http';
      const host = req.get('host') || `127.0.0.1:${port}`;
      const fullUrl = new URL(req.originalUrl, `${protocol}://${host}`);
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (typeof val === 'string') {
          headers.set(key, val);
        } else if (Array.isArray(val)) {
          headers.set(key, val.join(', '));
        }
      }
      const webReq = new Request(fullUrl.toString(), {
        method: req.method,
        headers,
      });
      const apiRes = await apiRouter.handle(webReq, {
        clientIp: req.ip || req.socket.remoteAddress || 'unknown',
        preParsedBody: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      });
      res.status(apiRes.status);
      apiRes.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.send(await apiRes.text());
    } catch (err) {
      next(err);
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`KSCAT-ERP server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start KSCAT-ERP server:', err);
  process.exit(1);
});
