import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { ADMIN_HTML } from '../src/api/admin/ui';

type Call = { url: string; method: string; key: string | null; body: any };

/** The admin panel with a fake resident Worker behind fetch. */
function panel(preferences: Record<string, string> = {}, routes: Record<string, (body: any) => [number, any]> = {}) {
  const storage = new Map(Object.entries(preferences));
  const calls: Call[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init.method, key: init.headers['x-web-key'] ?? null, body });
    if (init.headers['x-web-key'] !== 'web-key') return new Response('unauthorized', { status: 401 });
    const route = routes[`${init.method} ${new URL(url).pathname}`];
    if (!route) return Response.json({ error: 'not found' }, { status: 404 });
    const [status, payload] = route(body);
    return Response.json(payload, { status });
  };
  const script = ADMIN_HTML.match(/<script>\s*(function memoryAdmin\(\)[\s\S]*?)<\/script>/)?.[1] ?? '';
  const app = runInNewContext(`${script}\nmemoryAdmin()`, {
    fetch,
    Response,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    },
    location: { origin: 'https://aelios.test' },
    document: { documentElement: { dataset: {} }, querySelector: () => null, scrollingElement: null },
    window: { setTimeout() {}, clearTimeout() {}, confirm: () => true }
  });
  app.icons = () => {};
  app.notify = (message: string) => { app.toast = message; };
  app.$nextTick = (fn: () => void) => fn();
  return { app, storage, calls };
}

const LINES = [
  { id: 'u1', role: 'user', kind: 'chat', text: '你好', at: 1, via: 'telegram' },
  { id: 'a1', role: 'assistant', kind: 'chat', text: '在的。\n\n今天怎么样？', at: 2, via: 'telegram' }
];

test('without a resident the panel looks as before', () => {
  const { app } = panel();
  assert.equal(app.residentReady(), false);
  assert.equal(JSON.stringify(app.navItems().map((item: any) => item.id)), JSON.stringify(app.nav.map((item: any) => item.id)));
});

test('connecting checks the resident, keeps it on this device and adds the page after 今日', async () => {
  const { app, storage, calls } = panel({}, { 'GET /web/check': () => [200, { ok: true, aelios: true }] });
  app.residentUrlInput = 'aelios-resident.example.workers.dev';
  app.residentKeyInput = 'web-key';
  await app.residentConnect();
  assert.match(app.resident.connectError, /https:\/\//);
  assert.equal(calls.length, 0);

  app.residentUrlInput = 'https://aelios-resident.example.workers.dev/';
  app.residentKeyInput = 'wrong';
  await app.residentConnect();
  assert.equal(app.resident.connectError, '住户的钥匙不对');
  assert.equal(app.residentReady(), false);

  app.residentKeyInput = 'web-key';
  await app.residentConnect();
  assert.equal(calls.at(-1)?.url, 'https://aelios-resident.example.workers.dev/web/check');
  assert.equal(app.residentReady(), true);
  assert.equal(app.residentKeyInput, '');
  assert.equal(storage.get('aelios.admin.residentUrl'), 'https://aelios-resident.example.workers.dev');
  assert.equal(storage.get('aelios.admin.residentKey'), 'web-key');
  assert.equal(JSON.stringify(app.navItems().slice(0, 2).map((item: any) => item.id)), '["today","resident"]');

  app.page = 'resident';
  app.residentDisconnect();
  assert.equal(app.residentReady(), false);
  assert.equal(app.page, 'today');
  assert.equal(storage.has('aelios.admin.residentKey'), false);
});

test('the page shows the shared conversation and what is said here goes to the resident', async () => {
  let lines = LINES.slice();
  const { app, calls } = panel(
    { 'aelios.admin.residentUrl': 'https://r.example', 'aelios.admin.residentKey': 'web-key' },
    {
      'GET /web/messages': () => [200, { data: lines }],
      'GET /web/persona': () => [200, { text: '', at: null, fallback: '默认一句', versions: [] }],
      'POST /web/say': (body) => {
        lines = lines.concat([
          { id: 'u2', role: 'user', kind: 'chat', text: body.text, at: 3, via: 'web' },
          { id: 'a2', role: 'assistant', kind: 'chat', text: '收到', at: 4, via: 'web' }
        ]);
        return [200, { status: 'completed' }];
      },
      'POST /web/pin': () => [200, { ok: true }]
    }
  );
  await app.go('resident');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.resident.lines.length, 2);
  assert.equal(app.resident.personaLoaded, true);
  assert.equal(app.resident.persona.text, '');
  assert.equal(JSON.stringify(app.residentBubbles(app.resident.lines[1])), '["在的。","今天怎么样？"]');
  assert.equal(app.residentVia('telegram'), 'Telegram');

  app.resident.draft = '  网页上说一句  ';
  await app.residentSend();
  const said = calls.find((call) => call.url === 'https://r.example/web/say');
  assert.equal(said?.body.text, '网页上说一句');
  assert.equal(app.resident.sending, false);
  assert.equal(app.resident.lines.at(-1).text, '收到');

  await app.residentPin(app.resident.lines.at(-1));
  assert.equal(app.resident.pinned.a2, true);
  assert.equal(app.toast, '已存进珍贵');
});

test('model and persona are changed on the page; a model that fails its trial call is not taken', async () => {
  let model: { model: string; at: number | null; fallback: string; lastUsage: unknown } = { model: '', at: null, fallback: '@cf/zai-org/glm-4.7-flash', lastUsage: { at: 5, input: 1000, cacheRead: 900, cacheWrite: 0, output: 20 } };
  const { app, calls } = panel(
    { 'aelios.admin.residentUrl': 'https://r.example', 'aelios.admin.residentKey': 'web-key' },
    {
      'GET /web/model': () => [200, model],
      'POST /web/model': (body) => {
        if (body.text === 'anthropic/claude-nope') return [400, { error: '这个模型用不了：not found' }];
        model = { ...model, model: body.text, at: 6 };
        return [200, model];
      },
      'GET /web/persona': () => [200, { text: '旧人设', at: 1, fallback: '默认一句', versions: [] }],
      'POST /web/persona': (body) => [200, { text: body.text.trim(), at: 7, fallback: '默认一句', versions: [{ at: 1, text: '旧人设' }] }]
    }
  );
  await app.residentToggleView();
  assert.equal(app.residentView, 'settings');
  assert.equal(app.resident.personaDraft, '旧人设');
  assert.match(app.residentUsage(app.resident.model.lastUsage), /缓存读 900（90%）/);

  app.resident.modelDraft = 'anthropic/claude-nope';
  await app.residentSaveModel();
  assert.equal(app.resident.modelError, '这个模型用不了：not found');
  assert.equal(app.resident.model.model, '');

  app.resident.modelDraft = 'anthropic/claude-opus-5.5';
  await app.residentSaveModel();
  assert.equal(app.resident.modelError, '');
  assert.equal(app.resident.model.model, 'anthropic/claude-opus-5.5');

  app.resident.personaDraft = '新人设 ';
  assert.equal(app.residentPersonaDirty(), true);
  await app.residentSavePersona();
  assert.equal(app.resident.persona.text, '新人设');
  assert.equal(app.residentPersonaDirty(), false);
  assert.equal(calls.filter((call) => call.method === 'POST').every((call) => call.key === 'web-key'), true);

  await app.residentToggleView();
  assert.equal(app.residentView, 'chat');
});
