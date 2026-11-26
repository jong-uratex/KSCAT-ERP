import { initDatabase } from '../../server/db.ts';
import { createD1DbClient, type AppEnv, type D1DatabaseLike } from '../../server/db_adapter.ts';
import { createApiRouter } from '../../server/routes.ts';

interface PagesEnv extends AppEnv {
  DB?: D1DatabaseLike;
  API_ORIGIN?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: PagesEnv;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function isDisallowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (/^169\.254\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  const m172 = /^172\.(\d+)\./.exec(host);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return true;
  }
  return false;
}

function parseValidatedOrigin(rawOrigin?: string): { url: URL | null; reason: 'missing' | 'invalid' | null } {
  const trimmed = (rawOrigin ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (!trimmed) return { url: null, reason: 'missing' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, reason: 'invalid' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { url: null, reason: 'invalid' };
  }
  if (parsed.username || parsed.password || isDisallowedHost(parsed.hostname)) {
    return { url: null, reason: 'invalid' };
  }
  return { url: parsed, reason: null };
}

export async function onRequest(context: PagesFunctionContext): Promise<Response> {
  // Primary Cloudflare-native mode: serve all API routes directly from Cloudflare D1 database binding `DB`
  if (context.env.DB) {
    try {
      const db = createD1DbClient(context.env.DB);
      await initDatabase(db);
      const router = createApiRouter(db, context.env);
      const clientIp = context.request.headers.get('CF-Connecting-IP') || 'unknown';
      return await router.handle(context.request, { clientIp });
    } catch (err) {
      console.error('Cloudflare D1 API error:', err);
      return new Response(
        JSON.stringify({
          error:
            err instanceof Error
              ? `Cloudflare D1 error: ${err.message}`
              : 'Cloudflare D1 database request failed.',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        }
      );
    }
  }

  // Fallback mode: proxy to external Node backend if API_ORIGIN is configured
  const { url: originUrl, reason } = parseValidatedOrigin(context.env.API_ORIGIN);
  if (!originUrl) {
    const message =
      reason === 'invalid'
        ? 'Cloudflare D1 binding "DB" is missing and API_ORIGIN is invalid. Add a D1 binding named DB in Cloudflare Pages (Settings -> Functions -> D1 database bindings).'
        : 'Cloudflare D1 database is not connected yet. In Cloudflare Pages, go to Settings -> Functions -> D1 database bindings, add a D1 database with Variable name "DB", and redeploy.';
    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  const incomingUrl = new URL(context.request.url);
  const basePath = originUrl.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  const targetUrl = new URL(`${basePath}${incomingUrl.pathname}${incomingUrl.search}`, originUrl.origin);

  const forwardHeaders = new Headers();
  context.request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      forwardHeaders.set(key, value);
    }
  });

  const clientIp = context.request.headers.get('CF-Connecting-IP');
  if (clientIp) {
    const existing = forwardHeaders.get('X-Forwarded-For');
    forwardHeaders.set('X-Forwarded-For', existing ? `${existing}, ${clientIp}` : clientIp);
  }
  forwardHeaders.set('X-Forwarded-Host', incomingUrl.host);
  forwardHeaders.set('X-Forwarded-Proto', incomingUrl.protocol.replace(/:$/, ''));

  const method = context.request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(targetUrl.toString(), {
      method,
      headers: forwardHeaders,
      body: hasBody ? context.request.body : undefined,
      redirect: 'manual',
    });
  } catch {
    return new Response(
      JSON.stringify({
        error: 'Unable to reach the configured API_ORIGIN backend server.',
      }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const responseHeaders = new Headers(upstreamRes.headers);
  if (!responseHeaders.has('Cache-Control')) {
    responseHeaders.set('Cache-Control', 'no-store');
  }

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: responseHeaders,
  });
}
