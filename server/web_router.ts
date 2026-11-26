export interface ApiRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: any;
  headers: Record<string, string | undefined>;
  ip: string;
  socket: { remoteAddress?: string };
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(payload: unknown): void;
}

export type NextFunction = () => void | Promise<void>;

export type RouteHandler<TReq extends ApiRequest = ApiRequest> = (
  req: TReq,
  res: ApiResponse,
  next: NextFunction
) => void | Promise<void>;

interface RouteEntry {
  method: string | null;
  pattern: string | null;
  paramNames: string[];
  regex: RegExp | null;
  handlers: RouteHandler[];
}

function compilePath(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {
    regex: new RegExp(`^${escaped}$`),
    paramNames,
  };
}

export class WebRouter {
  private entries: RouteEntry[] = [];

  use(arg: WebRouter | RouteHandler): void {
    if (arg instanceof WebRouter) {
      this.entries.push(...arg.entries);
    } else {
      this.entries.push({
        method: null,
        pattern: null,
        paramNames: [],
        regex: null,
        handlers: [arg],
      });
    }
  }

  private addRoute(method: string, pattern: string, handlers: RouteHandler[]): void {
    const { regex, paramNames } = compilePath(pattern);
    this.entries.push({
      method: method.toUpperCase(),
      pattern,
      paramNames,
      regex,
      handlers,
    });
  }

  get<TReq extends ApiRequest = ApiRequest>(pattern: string, ...handlers: Array<RouteHandler<TReq>>): void {
    this.addRoute('GET', pattern, handlers as RouteHandler[]);
  }

  post<TReq extends ApiRequest = ApiRequest>(pattern: string, ...handlers: Array<RouteHandler<TReq>>): void {
    this.addRoute('POST', pattern, handlers as RouteHandler[]);
  }

  put<TReq extends ApiRequest = ApiRequest>(pattern: string, ...handlers: Array<RouteHandler<TReq>>): void {
    this.addRoute('PUT', pattern, handlers as RouteHandler[]);
  }

  patch<TReq extends ApiRequest = ApiRequest>(pattern: string, ...handlers: Array<RouteHandler<TReq>>): void {
    this.addRoute('PATCH', pattern, handlers as RouteHandler[]);
  }

  delete<TReq extends ApiRequest = ApiRequest>(pattern: string, ...handlers: Array<RouteHandler<TReq>>): void {
    this.addRoute('DELETE', pattern, handlers as RouteHandler[]);
  }

  async handle(
    request: Request,
    options: { clientIp?: string; preParsedBody?: unknown } = {}
  ): Promise<Response> {
    const url = new URL(request.url);
    const rawPathname = url.pathname;
    const strippedPath = rawPathname.startsWith('/api')
      ? rawPathname.slice(4) || '/'
      : rawPathname || '/';

    const method = request.method.toUpperCase();
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const headers: Record<string, string | undefined> = {};
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    let body: unknown = options.preParsedBody;
    if (body === undefined && method !== 'GET' && method !== 'HEAD') {
      const contentType = (headers['content-type'] ?? '').toLowerCase();
      if (contentType.includes('application/json') || contentType === '') {
        try {
          const text = await request.text();
          if (text.length > 1024 * 1024) {
            return new Response(JSON.stringify({ error: 'Payload too large.' }), {
              status: 413,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
          }
          body = text.trim() ? JSON.parse(text) : {};
        } catch {
          return new Response(JSON.stringify({ error: 'Invalid JSON request body.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
        }
      }
    }

    const req: ApiRequest = {
      method,
      path: strippedPath,
      params: {},
      query,
      body: body ?? {},
      headers,
      ip: options.clientIp || headers['cf-connecting-ip'] || headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown',
      socket: { remoteAddress: options.clientIp },
    };

    let statusCode = 200;
    let sent = false;
    let responsePayload: unknown = undefined;

    const res: ApiResponse = {
      status(code: number): ApiResponse {
        statusCode = code;
        return res;
      },
      json(payload: unknown): void {
        sent = true;
        responsePayload = payload;
      },
    };

    try {
      for (const entry of this.entries) {
        if (sent) break;
        if (entry.method !== null) {
          if (entry.method !== method || !entry.regex) continue;
          const match = entry.regex.exec(strippedPath);
          if (!match) continue;
          const params: Record<string, string> = {};
          entry.paramNames.forEach((name, idx) => {
            params[name] = decodeURIComponent(match[idx + 1] ?? '');
          });
          req.params = params;
        }

        for (const handler of entry.handlers) {
          if (sent) break;
          let nextCalled = false;
          await handler(req, res, () => {
            nextCalled = true;
          });
          if (!nextCalled && !sent) {
            break;
          }
        }
      }

      if (!sent) {
        return new Response(JSON.stringify({ error: 'API endpoint not found.' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }

      return new Response(JSON.stringify(responsePayload), {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      console.error('API route execution error:', err);
      return new Response(
        JSON.stringify({ error: 'Internal server error processing request.' }),
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
}
