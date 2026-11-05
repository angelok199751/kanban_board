/**
 * QA Flow: бесплатный прокси к Supabase через Cloudflare Workers.
 *
 * Зачем: в некоторых рабочих сетях провайдер блокирует `supabase.co`.
 * Зеркало приложения на GitHub Pages обращается к этому Worker, а Worker —
 * к тому же самому проекту Supabase. Данные не копируются, второй проект
 * не создаётся, RLS и правила доступа остаются прежними.
 *
 * Что проксируется:
 *   /auth/v1/*      — вход, токены, смена пароля;
 *   /rest/v1/*      — таблицы и RPC;
 *   /realtime/v1/*  — WebSocket для совместного редактирования.
 *
 * Безопасность:
 *   - целевой адрес жёстко зашит (меняется только через env.SUPABASE_URL);
 *   - принимаются запросы только с известных origin (GitHub Pages и localhost);
 *   - произвольные пути и чужие хосты не проксируются.
 *
 * Публичный ключ Supabase и так лежит в браузерной сборке. Настоящая защита
 * данных — RLS в базе, а не этот Worker.
 */

export const DEFAULT_SUPABASE_URL = 'https://kpwsonthpczijvcesgnj.supabase.co';

const GITHUB_ORIGIN = 'https://angelok199751.github.io';
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;
const ALLOWED_PATH = /^\/(?:auth|rest|realtime)\/v1(?:\/|$)/;

/** Разрешён ли origin браузера. Пустой origin (curl, health-check) сюда не проходит. */
export function isAllowedOrigin(origin) {
  if (!origin) return false;
  return origin === GITHUB_ORIGIN || LOCAL_ORIGIN.test(origin);
}

/** Проксируются только пути Supabase Auth, REST и Realtime. */
export function isAllowedPath(pathname) {
  return ALLOWED_PATH.test(pathname);
}

/**
 * Собирает адрес Supabase, сохраняя путь и query string исходного запроса.
 * Хост всегда берётся из baseUrl, поэтому подменить его через URL нельзя.
 */
export function buildUpstreamUrl(requestUrl, baseUrl = DEFAULT_SUPABASE_URL) {
  const incoming = new URL(requestUrl);
  const target = new URL(baseUrl);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  target.hash = '';
  return target;
}

function normalizeBase(value) {
  return String(value || DEFAULT_SUPABASE_URL).trim().replace(/\/+$/, '');
}

function addCors(headers, origin) {
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  const vary = headers.get('Vary');
  if (!vary) {
    headers.set('Vary', 'Origin');
  } else if (vary.trim() !== '*' && !/(?:^|,)\s*origin\s*(?:,|$)/i.test(vary)) {
    headers.set('Vary', `${vary}, Origin`);
  }
}

function plainText(status, message, origin) {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (origin && isAllowedOrigin(origin)) addCors(headers, origin);
  return new Response(message, { status, headers });
}

function preflight(request, origin) {
  const headers = new Headers();
  addCors(headers, origin);
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    request.headers.get('Access-Control-Request-Headers') ||
      'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer',
  );
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(null, { status: 204, headers });
}

function healthResponse(request, base) {
  const origin = request.headers.get('Origin');
  if (origin && !isAllowedOrigin(origin)) {
    return plainText(403, 'Origin is not allowed', null);
  }
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (origin) addCors(headers, origin);
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'qaflow-supabase-proxy',
      target: base,
      time: new Date().toISOString(),
    }),
    { status: 200, headers },
  );
}

export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const base = normalizeBase(env && env.SUPABASE_URL);

    if (incoming.pathname === '/health' || incoming.pathname === '/health/') {
      return healthResponse(request, base);
    }

    const origin = request.headers.get('Origin');

    // Сначала проверяем путь: на любой другой адрес Worker не должен быть открытым прокси.
    if (!isAllowedPath(incoming.pathname)) {
      return plainText(404, 'Not found', origin);
    }

    // Браузер всегда присылает Origin для CORS и WebSocket. Без него — отказ,
    // чтобы Worker нельзя было использовать как общий шлюз к Supabase.
    if (!isAllowedOrigin(origin)) {
      return plainText(403, 'Origin is not allowed', null);
    }

    if (request.method === 'OPTIONS') {
      return preflight(request, origin);
    }

    const target = buildUpstreamUrl(request.url, base);

    // Убираем заголовки, которые относятся к Cloudflare/клиенту, а не к Supabase.
    const headers = new Headers(request.headers);
    for (const name of [
      'host',
      'cf-connecting-ip',
      'cf-ipcountry',
      'cf-ray',
      'cf-visitor',
      'x-forwarded-for',
      'x-forwarded-proto',
      'x-real-ip',
    ]) {
      headers.delete(name);
    }

    const isWebSocket = (headers.get('Upgrade') || '').toLowerCase() === 'websocket';

    try {
      if (isWebSocket) {
        // Для WebSocket нельзя пересобирать body: передаём запрос как есть,
        // сохраняя Upgrade, Sec-WebSocket-* и query string с apikey.
        return await fetch(
          new Request(target.toString(), {
            method: request.method,
            headers,
          }),
        );
      }

      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const upstream = new Request(target.toString(), {
        method: request.method,
        headers,
        body: hasBody ? request.body : undefined,
        redirect: 'manual',
        // Нужно Node.js при передаче потока (тесты); Cloudflare это поле игнорирует.
        duplex: 'half',
      });

      const response = await fetch(upstream);
      const responseHeaders = new Headers(response.headers);
      addCors(responseHeaders, origin);
      responseHeaders.set('Access-Control-Expose-Headers', 'Content-Range, Range, X-Client-Info');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch {
      return plainText(502, 'Supabase is unavailable through this proxy', origin);
    }
  },
};
