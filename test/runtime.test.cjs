'use strict';

// Real Koishi 4.18 runtime + the official mock chat adapter. The HTTP payloads
// below are deliberately SYNTHETIC contracts, never recorded Wizard404 data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Context } = require('koishi');
const mock = require('@koishijs/plugin-mock').default;
const plugin = require('../lib/index.cjs');

const BIG_ID = '4611686020152371460';
const TEST_KEY = 'test-secret-do-not-disclose';
const TEST_AGENT = 'wizard101-runtime-test/1.0 (test@example.invalid)';

function localeFixture() {
  return {
    schemaVersion: 1,
    source: { filename: 'synthetic.lang', sha256: 'test-only' },
    stats: { langFiles: 1, entries: 4, bilingualEntries: 4 },
    files: [{ path: 'Locale/en-US/RuntimeFixture.lang', table: 'RuntimeFixture', records: 4 }],
    entries: [
      [0, 'fire-cat', 'Fire Cat', '火焰猫'],
      [0, 'ice-serpent', 'Snow Serpent', '雪蛇'],
      [0, 'candle', 'Ghost Candle', '鬼影蜡烛'],
      [0, 'evil', '<at type="all"/>', '恶意文本测试'],
    ],
  };
}

function json(response, value, status = 200, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  response.end(typeof value === 'string' ? value : JSON.stringify(value));
}

function defaultResponse(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (/\/search$/u.test(url.pathname) || url.pathname === '/api/v1/items') {
    const page = Number(url.searchParams.get('page') || 1);
    const data = page === 1
      ? [{ template_id: '1001', name: 'Fire Cat' }, { template_id: '1002', name: 'Ghost Candle' }]
      : [{ template_id: '1003', name: 'Snow Serpent' }];
    return json(response, { success: true, data, pagination: {
      page, total: 3, total_pages: 2, next_page: page === 1 ? 2 : null,
    } });
  }
  const id = decodeURIComponent(url.pathname.split('/').at(-1));
  const names = { 1001: 'Fire Cat', 1002: 'Ghost Candle', 1003: 'Snow Serpent' };
  return json(response, { success: true, data: { template_id: id, name: names[id] || 'Synthetic item', school: 'Fire', rank: 1 } });
}

async function setup(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wizard101-runtime-'));
  const localePath = path.join(directory, 'locale.json');
  await fs.writeFile(localePath, JSON.stringify(localeFixture()));
  const requests = [];
  const sentElements = [];
  const server = http.createServer((request, response) => {
    requests.push({ url: request.url, method: request.method, headers: request.headers });
    try { (options.respond || defaultResponse)(request, response); }
    catch (error) { json(response, { success: false, error: error.message }, 500); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = new Context({ prefix: '', autoAuthorize: 1, delay: { character: 0, message: 0 } });
  app.plugin(mock);
  app.before('send', session => { sentElements.push(session.elements); });
  const fork = app.plugin(plugin, {
    baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
    apiKey: TEST_KEY,
    authMode: 'bearer',
    userAgent: TEST_AGENT,
    localePath,
    onlineSearchEnabled: true,
    searchParam: 'q',
    pageParam: 'page',
    pageSizeParam: 'limit',
    pageSize: 2,
    minIntervalMs: 0,
    cooldownMs: 0,
    timeoutMs: 1500,
    cacheTtlMs: 1000,
    maxCacheEntries: 32,
    ...options.config,
  });
  t.after(async () => {
    await app.stop();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await app.start();
  const client = app.mock.client('runtime-user');
  return { app, fork, client, requests, sentElements };
}

test('offline Chinese dictionary works without making HTTP requests', async t => {
  const { client, requests } = await setup(t, { config: { onlineSearchEnabled: false, apiKey: '' } });
  const replies = await client.receive('wiz.dict 火焰猫');
  assert.match(replies.join('\n'), /Fire Cat/u);
  assert.match(replies.join('\n'), /火焰猫/u);
  assert.equal(requests.length, 0);
});

test('missing private dictionary explains import while English and ID queries remain available', async t => {
  const missingPath = path.join(os.tmpdir(), `wizard101-absent-${process.pid}-${Date.now()}`, 'missing.json.gz');
  const { client, requests } = await setup(t, {
    config: { localePath: missingPath, onlineSearchEnabled: true },
  });
  for (const command of ['wiz.dict 火焰猫', 'wiz.spell 火焰猫']) {
    const replies = (await client.receive(command)).join('\n');
    assert.match(replies, /尚未导入有效中文词典/u);
    assert.match(replies, /tools\/locale\/import\.cjs/u);
    assert.match(replies, /localePath/u);
    assert.doesNotMatch(replies, new RegExp(String(process.pid)));
  }
  assert.equal(requests.length, 0, 'a missing dictionary must not turn Chinese input into a guessed API query');

  const englishReplies = (await client.receive('wiz.search -t spell Fire Cat')).join('\n');
  assert.match(englishReplies, /Fire Cat/u);
  assert.equal(requests.length, 1);
  const search = new URL(requests[0].url, 'http://localhost');
  assert.equal(search.pathname, '/api/v1/spells/search');
  assert.equal(search.searchParams.get('q'), 'Fire Cat');

  const detailReplies = (await client.receive('wiz.detail spell 1001')).join('\n');
  assert.match(detailReplies, /Fire Cat/u);
  assert.match(detailReplies, /1001/u);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].url, '/api/v1/spells/1001');
});

test('real command parser preserves English spaces, type option, auth and contact headers', async t => {
  const { client, requests } = await setup(t);
  const replies = await client.receive('wiz.search -t spell Fire Cat');
  assert.match(replies.join('\n'), /Fire Cat/u);
  const search = requests.find(entry => entry.url.startsWith('/api/v1/spells/search?'));
  assert.ok(search, 'spell search must use the documented route');
  const url = new URL(search.url, 'http://localhost');
  assert.equal(url.searchParams.get('q'), 'Fire Cat');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('limit'), '2');
  assert.equal(search.headers.authorization, `Bearer ${TEST_KEY}`);
  assert.equal(search.headers['user-agent'], TEST_AGENT);
  assert.equal(search.headers['x-api-key'], undefined);
});

test('Chinese search uses the actual bilingual dictionary entry', async t => {
  const { client, requests } = await setup(t);
  const replies = await client.receive('wiz.spell 火焰猫');
  assert.match(replies.join('\n'), /Fire Cat|火焰猫/u);
  const search = requests.find(entry => entry.url.includes('/spells/search?'));
  assert.ok(search);
  assert.equal(new URL(search.url, 'http://localhost').searchParams.get('q'), 'Fire Cat');
});

test('pagination and selection stay scoped to the originating user and channel', async t => {
  const { app, client, requests } = await setup(t, {
    respond(request, response) {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.endsWith('/search')) {
        const page = Number(url.searchParams.get('page') || 1);
        const data = page === 1
          ? [{ template_id: '1001', name: 'Arcane Cat A' }, { template_id: '1002', name: 'Arcane Cat B' }]
          : [{ template_id: '1003', name: 'Arcane Cat C' }];
        return json(response, { success: true, data, pagination: {
          page, total: 3, total_pages: 2, next_page: page === 1 ? 2 : null,
        } });
      }
      return json(response, { success: true, data: { template_id: '1003', name: 'Arcane Cat C' } });
    },
  });
  await client.receive('wiz.search -t spell Cat');
  const before = requests.length;
  const stranger = app.mock.client('another-user');
  await stranger.receive('wiz.pick 1');
  await stranger.receive('wiz.next');
  assert.equal(requests.length, before, 'another user must not use the first user search state');
  const sameUserOtherChannel = app.mock.client('runtime-user', 'other-channel');
  await sameUserOtherChannel.receive('wiz.pick 1');
  assert.equal(requests.length, before, 'private results must not leak into a group');
  const page2 = await client.receive('wiz.next');
  assert.match(page2.join('\n'), /Arcane Cat C/u);
  const picked = await client.receive('wiz.pick 1');
  assert.match(picked.join('\n'), /Arcane Cat C/u);
  assert.ok(requests.some(entry => entry.url === '/api/v1/spells/1003'));
});

test('detail IDs larger than Number.MAX_SAFE_INTEGER remain exact', async t => {
  const { client, requests } = await setup(t, {
    respond(_request, response) {
      // Deliberately an unquoted 64-bit integer in the JSON transport.
      json(response, `{"success":true,"data":{"template_id":${BIG_ID},"name":"Exact quest ID"}}`);
    },
  });
  const replies = await client.receive(`wiz.detail quest ${BIG_ID}`);
  assert.ok(requests.some(entry => entry.url === `/api/v1/quests/${BIG_ID}`));
  assert.match(replies.join('\n'), new RegExp(BIG_ID, 'u'));
  assert.doesNotMatch(replies.join('\n'), /4611686020152371000/u);
});

test('X-API-Key mode sends one auth scheme and never echoes the secret', async t => {
  const { client, requests } = await setup(t, { config: { authMode: 'x-api-key' } });
  const replies = await client.receive('wiz.detail item 1001');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers['x-api-key'], TEST_KEY);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.doesNotMatch(replies.join('\n'), new RegExp(TEST_KEY, 'u'));
});

test('untrusted API message tags remain plain text elements', async t => {
  const { client, sentElements } = await setup(t, {
    respond(_request, response) {
      json(response, { success: true, data: {
        template_id: '1009', name: '<at type="all"/>',
        description: '<img src="file:///private/path"/>',
      } });
    },
  });
  const replies = await client.receive('wiz.detail item 1009');
  assert.ok(replies.length, 'detail query should reply');
  assert.ok(sentElements.length);
  const flatten = elements => elements.flatMap(element => [element, ...flatten(element.children || [])]);
  assert.equal(sentElements.flatMap(flatten).filter(element => ['at', 'img', 'image', 'audio', 'video'].includes(element.type)).length, 0);
});

test('401 is not retried and the public error hides credentials', async t => {
  const { client, requests } = await setup(t, {
    respond(_request, response) {
      json(response, { success: false, error: `Authorization failed: ${TEST_KEY}` }, 401);
    },
  });
  const replies = await client.receive('wiz.detail item 1001');
  assert.equal(requests.length, 1);
  assert.ok(replies.length);
  assert.match(replies.join('\n'), /401|密钥|鑰|API Key|认证|认证|鉴权/u);
  assert.doesNotMatch(replies.join('\n'), new RegExp(TEST_KEY, 'u'));
});

for (const status of [429, 503]) {
  test(`${status} honors Retry-After and avoids a second request during cooldown`, async t => {
    const { client, requests } = await setup(t, {
      respond(_request, response) {
        json(response, { success: false, error: `private diagnostic ${TEST_KEY}` }, status, { 'Retry-After': '1' });
      },
    });
    const first = await client.receive('wiz.detail item 1001');
    const second = await client.receive('wiz.detail item 1002');
    assert.equal(requests.length, 1);
    assert.ok(first.length && second.length);
    assert.doesNotMatch([...first, ...second].join('\n'), new RegExp(TEST_KEY, 'u'));
    assert.match([...first, ...second].join('\n'), /秒|稍后|冷却|重试|稍後/u);
    await new Promise(resolve => setTimeout(resolve, 1100));
    await client.receive('wiz.detail item 1003');
    assert.equal(requests.length, 2, 'a manually retried request should resume after the cooldown');
  });
}

test('Cloudflare HTML is reported as a failure instead of a wiki result', async t => {
  const { client, requests } = await setup(t, {
    respond(_request, response) {
      response.writeHead(403, { 'Content-Type': 'text/html' });
      response.end('<html><title>Cloudflare challenge</title>private diagnostics</html>');
    },
  });
  const replies = await client.receive('wiz.detail item 1001');
  assert.equal(requests.length, 1);
  assert.ok(replies.length);
  assert.doesNotMatch(replies.join('\n'), /private diagnostics/u);
  assert.match(replies.join('\n'), /403|拒绝|拒絕|访问|存取|上游|服务/u);
});

test('disposing the plugin removes its commands from the real Koishi registry', async t => {
  const { app, fork, client } = await setup(t);
  assert.ok(app.$commander.get('wiz'));
  await fork.dispose();
  assert.equal(app.$commander.get('wiz'), undefined);
  assert.equal(app.$commander.get('wiz.search'), undefined);
  assert.deepEqual(await client.receive('wiz.dict 火焰猫'), []);
});

test('disposing during asynchronous locale initialization releases the late dictionary', async t => {
  const { LocaleDictionary } = require('../lib/locale.cjs');
  const originalLoad = LocaleDictionary.load;
  const dictionary = new LocaleDictionary(localeFixture());
  let begin;
  let release;
  const entered = new Promise(resolve => { begin = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  LocaleDictionary.load = async () => {
    begin();
    await pending;
    return dictionary;
  };
  const app = new Context({ prefix: '' });
  app.plugin(mock);
  const fork = app.plugin(plugin, { apiKey: '', userAgent: '', onlineSearchEnabled: false });
  t.after(async () => {
    release();
    LocaleDictionary.load = originalLoad;
    await app.stop();
  });
  const starting = app.start();
  await entered;
  await fork.dispose();
  release();
  await starting;
  assert.equal(dictionary.stats().disposed, true);
  assert.equal(app.$commander.get('wiz'), undefined);
});
