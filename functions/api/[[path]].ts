interface PagesEnv {
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

function parseValidatedOrigin(rawOrigin?: string): URL | null {
  const trimmed = (rawOrigin ?? '').trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }
  if (parsed.username || parsed.password || isDisallowedHost(parsed.hostname)) {
    return null;
  }
  return parsed;
}

export async function onRequest(context: PagesFunctionContext): Promise<Response> {
  const originUrl = parseValidatedOrigin(context.env.API_ORIGIN);
  if (!originUrl) {
    return new Response(
      JSON.stringify({
        error:
          'Backend API origin is not configured. Set a valid HTTPS API_ORIGIN in Cloudflare Pages environment variables or VITE_API_BASE_URL at build time.',
      }),
      {
        status: 503,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  const incomingUrl = new URL(context.request.url);
  const basePath = originUrl.pathname.replace(/\/+$/, '');
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

  const upstreamRes = await fetch(targetUrl.toString(), {
    method,
    headers: forwardHeaders,
    body: hasBody ? context.request.body : undefined,
    redirect: 'manual',
  });

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
