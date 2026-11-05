// Проверки Cloudflare Worker без Cloudflare: подменяем fetch и смотрим,
// какие запросы Worker пропускает к Supabase, а какие отклоняет.
import worker, {
  buildUpstreamUrl,
  DEFAULT_SUPABASE_URL,
  isAllowedOrigin,
  isAllowedPath,
} from '../../proxy/cloudflare-worker.js';

const eq = (a: unknown, b: unknown, m: string) => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`FAIL ${m}: ${x} != ${y}`);
};
const ok = (value: unknown, m: string) => {
  if (!value) throw new Error(`FAIL ${m}`);
};

// ---------------------------------------------------------------- правила
ok(isAllowedOrigin('https://angelok199751.github.io'), 'GitHub Pages разрешён');
ok(isAllowedOrigin('http://localhost:5173'), 'localhost разрешён');
ok(isAllowedOrigin('http://127.0.0.1:4173'), '127.0.0.1 разрешён');
ok(isAllowedOrigin('http://[::1]:5173'), 'IPv6 localhost разрешён');
ok(!isAllowedOrigin('https://angelok199751.github.io.evil.example'), 'похожий чужой домен запрещён');
ok(!isAllowedOrigin('http://localhost.evil.example:5173'), 'localhost-обманка запрещена');
ok(!isAllowedOrigin('https://evil.example'), 'чужой origin запрещён');
ok(!isAllowedOrigin(null), 'пустой origin запрещён');

ok(isAllowedPath('/auth/v1/token'), 'auth разрешён');
ok(isAllowedPath('/rest/v1/tasks'), 'rest разрешён');
ok(isAllowedPath('/realtime/v1/websocket'), 'realtime разрешён');
ok(isAllowedPath('/auth/v1'), 'корень auth разрешён');
ok(!isAllowedPath('/auth/v2/token'), 'другая версия auth запрещена');
ok(!isAllowedPath('/storage/v1/object'), 'storage не проксируется');
ok(!isAllowedPath('/rest/v1evil'), 'похожий путь запрещён');
ok(!isAllowedPath('/'), 'корень запрещён');

// ---------------------------------------------------------------- адрес Supabase
eq(
  buildUpstreamUrl('https://proxy.workers.dev/rest/v1/tasks?select=*&board_id=eq.1').toString(),
  `${DEFAULT_SUPABASE_URL}/rest/v1/tasks?select=*&board_id=eq.1`,
  'путь и query сохраняются, хост — Supabase',
);
eq(
  buildUpstreamUrl('https://proxy.workers.dev//evil.example/rest/v1/tasks').host,
  'kpwsonthpczijvcesgnj.supabase.co',
  'хост нельзя подменить двойным слэшем в пути',
);
eq(
  buildUpstreamUrl('https://proxy.workers.dev/realtime/v1/websocket?apikey=x', 'https://other.supabase.co/').toString(),
  'https://other.supabase.co/realtime/v1/websocket?apikey=x',
  'базовый адрес можно переопределить, хвостовой слэш убирается',
);

// ---------------------------------------------------------------- HTTP
const realFetch = globalThis.fetch;
let calls: Request[] = [];
let reply: () => Response | Promise<Response> = () =>
  new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-range': '0-0/1',
      'access-control-allow-origin': '*',
    },
  });

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const request = input as Request;
  calls.push(request);
  return reply();
}) as typeof fetch;

const run = async (input: string, init?: RequestInit) => {
  calls = [];
  return worker.fetch(new Request(input, init), {});
};

try {
  // health доступен без Origin — по нему удобно проверять, что Worker жив.
  {
    const response = await run('https://proxy.workers.dev/health');
    eq(response.status, 200, 'health отвечает 200');
    const body = (await response.json()) as Record<string, unknown>;
    eq(body.ok, true, 'health сообщает ok');
    eq(body.target, DEFAULT_SUPABASE_URL, 'health показывает целевой Supabase');
    eq(calls.length, 0, 'health не ходит в Supabase');
  }

  // Preflight с разрешённого origin.
  {
    const response = await run('https://proxy.workers.dev/rest/v1/tasks', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://angelok199751.github.io',
        'Access-Control-Request-Headers': 'apikey, authorization, content-type',
      },
    });
    eq(response.status, 204, 'preflight отвечает 204');
    eq(
      response.headers.get('access-control-allow-origin'),
      'https://angelok199751.github.io',
      'preflight возвращает разрешённый origin',
    );
    ok(
      (response.headers.get('access-control-allow-headers') ?? '').includes('authorization'),
      'preflight разрешает заголовки Supabase',
    );
    eq(calls.length, 0, 'preflight не ходит в Supabase');
  }

  // Обычный GET: путь, query и заголовки доходят до Supabase, CORS — обратно.
  {
    const response = await run('https://proxy.workers.dev/rest/v1/tasks?select=*&order=position.asc', {
      headers: {
        Origin: 'https://angelok199751.github.io',
        apikey: 'public-key',
        Authorization: 'Bearer token',
      },
    });
    eq(response.status, 200, 'GET отвечает 200');
    eq(calls.length, 1, 'GET ушёл в Supabase один раз');
    eq(
      calls[0].url,
      `${DEFAULT_SUPABASE_URL}/rest/v1/tasks?select=*&order=position.asc`,
      'GET ушёл на Supabase с тем же путём',
    );
    eq(calls[0].headers.get('apikey'), 'public-key', 'публичный ключ сохранён');
    eq(calls[0].headers.get('authorization'), 'Bearer token', 'токен сохранён');
    eq(calls[0].headers.get('host'), null, 'заголовок host не пересылается вручную');
    eq(
      response.headers.get('access-control-allow-origin'),
      'https://angelok199751.github.io',
      'в ответе CORS для GitHub Pages',
    );
    ok(
      (response.headers.get('access-control-expose-headers') ?? '').includes('Content-Range'),
      'Content-Range доступен приложению',
    );
  }

  // POST с телом (вход по паролю).
  {
    const response = await run('https://proxy.workers.dev/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: {
        Origin: 'https://angelok199751.github.io',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'anna@qa.flow', password: 'secret' }),
    });
    eq(response.status, 200, 'POST отвечает 200');
    eq(calls[0].method, 'POST', 'метод POST сохранён');
    eq(await calls[0].text(), '{"email":"anna@qa.flow","password":"secret"}', 'тело запроса сохранено');
  }

  // WebSocket: Worker не должен подменять ответ и терять Upgrade.
  // Node не умеет создавать Response со статусом 101, поэтому здесь проверяем
  // сам факт проксирования и заголовки; Cloudflare вернёт 101 как есть.
  {
    reply = () => new Response(null, { status: 200, headers: { Upgrade: 'websocket' } });
    const response = await run('https://proxy.workers.dev/realtime/v1/websocket?apikey=public-key&vsn=1.0.0', {
      headers: {
        Origin: 'https://angelok199751.github.io',
        Upgrade: 'websocket',
        Connection: 'Upgrade',
      },
    });
    eq(response.status, 200, 'ответ WebSocket возвращается без изменений');
    eq(response.headers.get('upgrade'), 'websocket', 'ответ сохраняет Upgrade');
    eq(calls[0].url, `${DEFAULT_SUPABASE_URL}/realtime/v1/websocket?apikey=public-key&vsn=1.0.0`, 'WebSocket идёт на Supabase');
    eq(calls[0].headers.get('upgrade'), 'websocket', 'Upgrade сохранён');
    reply = () => new Response('{}', { status: 200 });
  }

  // Запрещённые пути, чужие origin и запросы без Origin не должны доходить до Supabase.
  {
    const notFound = await run('https://proxy.workers.dev/storage/v1/object/secret', {
      headers: { Origin: 'https://angelok199751.github.io' },
    });
    eq(notFound.status, 404, 'чужой путь не проксируется');
    eq(calls.length, 0, 'чужой путь не дошёл до Supabase');
  }
  {
    const denied = await run('https://proxy.workers.dev/rest/v1/tasks', {
      headers: { Origin: 'https://evil.example' },
    });
    eq(denied.status, 403, 'чужой origin отклонён');
    eq(denied.headers.get('access-control-allow-origin'), null, 'чужому origin CORS не выдаётся');
    eq(calls.length, 0, 'чужой origin не дошёл до Supabase');
  }
  {
    const noOrigin = await run('https://proxy.workers.dev/rest/v1/tasks');
    eq(noOrigin.status, 403, 'запрос без Origin отклонён');
    eq(calls.length, 0, 'запрос без Origin не дошёл до Supabase');
  }

  // Если Supabase недоступен, приложение получает понятную ошибку с CORS.
  {
    reply = () => {
      throw new Error('network down');
    };
    const failed = await run('https://proxy.workers.dev/rest/v1/tasks', {
      headers: { Origin: 'https://angelok199751.github.io' },
    });
    eq(failed.status, 502, 'сбой Supabase превращается в 502');
    eq(
      failed.headers.get('access-control-allow-origin'),
      'https://angelok199751.github.io',
      'у ошибки тоже есть CORS',
    );
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log('proxy tests ok');
