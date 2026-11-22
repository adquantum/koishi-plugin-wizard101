'use strict';

// All successful HTTP responses below are intentionally synthetic fixtures.
// They verify transport/adapter behaviour, not Wizard404 live compatibility.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Wizard404Client, ApiError, parseJsonLossless, normalizeId,
  normalizeType, TYPES, unwrapDetail, unwrapList, entityId, entityName,
} = require('../lib/api.cjs');

const SECRET = 'w404_dev_synthetic_secret_do_not_log';
const baseConfig = {
  baseUrl: 'http://127.0.0.1:12345/api/v1',
  apiKey: SECRET,
  userAgent: 'subata-test/0.1 (contact: tests@example.invalid)',
  minIntervalMs: 0,
  timeoutMs: 1000,
};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const entity = id => ({ success: true, data: { template_id: id, name: `Fixture ${id}` } });
const codeIs = code => error => error instanceof ApiError && error.code === code;
const client = (fetch, config = {}, options = {}) => new Wizard404Client({ ...baseConfig, ...config }, { fetch, ...options });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('unsafe JSON integer tokens are strings without changing strings, escapes or ordinary numbers', () => {
  const parsed = parseJsonLossless('{"template_id":4611686020152371460,"negative":-9223372036854775808,"safe":123,"rate":0.125,"exp":1e20,"text":"x4611686020152371460\\\"y","nested":[9007199254740992]}');
  assert.equal(parsed.template_id, '4611686020152371460');
  assert.equal(parsed.negative, '-9223372036854775808');
  assert.equal(parsed.safe, 123);
  assert.equal(parsed.rate, 0.125);
  assert.equal(parsed.exp, '1e20');
  assert.equal(parsed.text, 'x4611686020152371460"y');
  assert.deepEqual(parsed.nested, ['9007199254740992']);
  for (const invalid of ['{"x":01}', '{"x":1e}', '{"x":"unterminated}', '<html>blocked</html>']) assert.throws(() => parseJsonLossless(invalid), codeIs('invalid-json'));
});

test('IDs remain decimal strings and reject numbers that already lost precision', () => {
  assert.equal(normalizeId('4611686020152371460'), '4611686020152371460');
  assert.equal(normalizeId(' 000123 '), '123');
  assert.equal(normalizeId(0), '0');
  for (const invalid of [4611686020152371460, -1, 1.5, '../x', '1e20', '1/cheats', {}, '']) assert.throws(() => normalizeId(invalid), codeIs('invalid-id'));
  assert.equal(entityId({ template_id: '123', id: 999 }), '123');
  assert.throws(() => entityId({ template_id: 4611686020152371460, id: '2' }), codeIs('invalid-id'));
});

test('type aliases use only documented routes and resist inherited object property names', () => {
  for (const [input, expected] of [['装备', 'item'], ['spells', 'spell'], ['法術', 'spell'], ['地点', 'zone'], ['NPC', 'npc'], ['quests', 'quest'], ['天赋', 'talent']]) assert.equal(normalizeType(input), expected);
  assert.equal(TYPES.recipe.detailPath('1'), '/recipes/1/preview');
  assert.equal(TYPES.recipe.searchPath, undefined);
  assert.equal(TYPES.item.searchPath, '/items');
  for (const invalid of ['constructor', '__proto__', '/events/sync-mob-events', null]) assert.throws(() => normalizeType(invalid), codeIs('invalid-type'));
});

test('known synthetic envelope shapes adapt without fabricating entities or pagination', () => {
  const item = { template_id: '1', display_name: 'Fire Cat', parsed_data: { extra: true } };
  assert.equal(unwrapDetail({ success: true, data: item }), item);
  assert.equal(unwrapDetail(item), item);
  assert.equal(entityName(item), 'Fire Cat');
  assert.equal(entityName({}), '');
  const list = unwrapList({ success: true, data: [item], pagination: { page: 1, total_pages: 2, next_page: 2, total: 9 } }, 'spells');
  assert.deepEqual(list, { items: [item], total: 9, page: 1, totalPages: 2, nextPage: 2 });
  assert.deepEqual(unwrapList({ data: { spells: [item] } }, 'spell').items, [item]);
  assert.deepEqual(unwrapList([item]).items, [item]);
  assert.deepEqual(unwrapList({ results: [] }).items, []);
  for (const bad of [{ message: 'none' }, { data: { total: 0 } }, { data: [1, 2] }]) assert.throws(() => unwrapList(bad), codeIs('unexpected-shape'));
  assert.throws(() => unwrapDetail({ data: [] }), codeIs('unexpected-shape'));
  assert.throws(() => unwrapDetail({ data: null }), codeIs('not-found'));
  assert.throws(() => unwrapList({ success: false, data: [] }), codeIs('api-error'));
});

test('empty credentials allow offline construction but block network work safely', async () => {
  let requests = 0;
  const c = client(async () => { requests++; return json(entity('1')); }, { apiKey: '', userAgent: '' });
  await assert.rejects(c.detail('spell', '1'), codeIs('missing-key'));
  const c2 = client(async () => { requests++; return json(entity('1')); }, { userAgent: 'subata/0.1' });
  await assert.rejects(c2.detail('spell', '1'), codeIs('user-agent'));
  assert.equal(requests, 0);
  c.dispose(); c2.dispose();
});

test('base URLs forbid secret-bearing, remote cleartext and redirect-ambiguous forms', () => {
  for (const baseUrl of ['http://wizard404.com/api/v1', 'https://user:pass@wizard404.com/api/v1', 'https://@wizard404.com/api/v1', 'https://wizard404.com/api/v1?token=x', 'https://wizard404.com/api/v1#x', 'file:///tmp/x', 'https:\\evil.example']) {
    assert.throws(() => client(async () => json({}), { baseUrl }), codeIs('invalid-config'));
  }
  const c = client(async () => json({}), { baseUrl: 'https://api.example.invalid/api/v1', minIntervalMs: 0 });
  assert.equal(c._minIntervalMs, 1200, 'remote production requests cannot disable the conservative pacing');
  c.dispose();
});

test('auth modes, ID precision and read-only routes are preserved at the HTTP boundary', async () => {
  const seen = [];
  const id = '4611686020152371460';
  const c = client(async (url, init) => {
    seen.push({ url, init });
    return new Response(`{"success":true,"data":{"template_id":${id},"name":"Synthetic"}}`, { headers: { 'Content-Type': 'application/json' } });
  });
  const result = await c.detail('quest', id);
  assert.equal(result.body.data.template_id, id);
  assert.ok(result.url.endsWith(`/quests/${id}`));
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.redirect, 'manual');
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${SECRET}`);
  const c2 = client(async (url, init) => { assert.equal(init.headers['X-API-Key'], SECRET); assert.equal(init.headers.Authorization, undefined); return json(entity('1')); }, { authMode: 'x-api-key' });
  await c2.detail('item', '1');
  await assert.rejects(c._request('/events/sync-mob-events'), codeIs('invalid-route'));
  assert.equal(seen.length, 1);
  c.dispose(); c2.dispose();
});

test('name search is opt-in, encoded and configurable; recipe search is not invented', async () => {
  let url;
  const c = client(async u => { url = new URL(u); return json({ success: true, data: [] }); });
  await assert.rejects(c.search('spell', 'Fire Cat'), codeIs('search-disabled'));
  const c2 = client(async u => { url = new URL(u); return json({ success: true, data: [] }); }, { onlineSearchEnabled: true, searchParam: 'name', pageParam: 'p', pageSizeParam: 'per_page', pageSize: 4 });
  await c2.search('spell', 'Fire & Ice', 2);
  assert.equal(url.pathname, '/api/v1/spells/search');
  assert.equal(url.searchParams.get('name'), 'Fire & Ice');
  assert.equal(url.searchParams.get('p'), '2');
  assert.equal(url.searchParams.get('per_page'), '4');
  assert.equal(url.searchParams.has('q'), false);
  await assert.rejects(c2.search('recipe', 'x'), codeIs('unsupported-search'));
  await assert.rejects(c2.search('spell', 'x', -1), codeIs('invalid-page'));
  const c3 = client(async u => { url = new URL(u); return json({ data: [] }); }, { onlineSearchEnabled: true, pageSizeParam: '' });
  await c3.search('spell', 'Fire Cat');
  assert.deepEqual([...url.searchParams.keys()], ['q', 'page']);
  c.dispose(); c2.dispose(); c3.dispose();
});

test('relations and exact zone lookups use allowlisted documented endpoints', async () => {
  const urls = [];
  const c = client(async url => { urls.push(new URL(url)); return json({ success: true, data: {} }); });
  await c.relation('123', 'drops');
  await c.relation('123', 'cheats');
  await c.relation('123', 'deck');
  await c.lookupZone('Krokotopia/KT_Pyramid/KT_Chamber');
  assert.deepEqual(urls.slice(0, 3).map(u => u.pathname), ['/api/v1/mobs/123/drops', '/api/v1/mobs/123/cheats', '/api/v1/mobs/123/deck']);
  assert.equal(urls[3].searchParams.get('object_name'), 'Krokotopia/KT_Pyramid/KT_Chamber');
  await assert.rejects(c.relation('123', '../unlock'), codeIs('invalid-relation'));
  c.dispose();
});

test('wrong detail IDs and unrecognized payloads are rejected instead of cached', async () => {
  let calls = 0;
  const c = client(async () => { calls++; return json(entity('999')); });
  await assert.rejects(c.detail('spell', '1'), codeIs('id-mismatch'));
  await assert.rejects(c.detail('spell', '1'), codeIs('id-mismatch'));
  assert.equal(calls, 2);
  assert.equal(c.stats().cacheEntries, 0);
  const c2 = client(async () => json({ status: 'ok', unrelated: true }));
  await assert.rejects(c2.detail('spell', '1'), codeIs('unexpected-shape'));
  c.dispose(); c2.dispose();
});

test('TTL/LRU cache and concurrent duplicate coalescing bound API traffic', async () => {
  let clock = 1000;
  let calls = 0;
  const c = client(async url => { calls++; return json(entity(url.split('/').pop())); }, { cacheTtlMs: 100, maxCacheEntries: 2 }, { now: () => clock });
  assert.equal((await c.detail('spell', '1')).cacheHit, false);
  assert.equal((await c.detail('spell', '1')).cacheHit, true);
  await c.detail('spell', '2');
  await c.detail('spell', '3');
  await c.detail('spell', '1');
  assert.equal(calls, 4);
  assert.equal(c.stats().cacheEntries, 2);
  clock += 101;
  assert.equal((await c.detail('spell', '1')).cacheHit, false);
  assert.equal(calls, 5);
  const gate = deferred();
  const c2 = client(async () => { await gate.promise; return json(entity('1')); });
  const a = c2.detail('spell', '1');
  const b = c2.detail('spell', '1');
  gate.resolve();
  await Promise.all([a, b]);
  assert.equal(c2.stats().requests, 1);
  assert.equal(c2.stats().coalesced, 1);
  c.dispose(); c2.dispose();
});

test('serial requests honor pacing using an injected monotonic test clock', async () => {
  let clock = 1000;
  const starts = [];
  const c = client(async url => { starts.push(clock); return json(entity(url.split('/').pop())); }, { minIntervalMs: 1200 }, { now: () => clock, sleep: async ms => { clock += ms; } });
  await Promise.all([c.detail('spell', '1'), c.detail('spell', '2'), c.detail('spell', '3')]);
  assert.deepEqual(starts, [1000, 2200, 3400]);
  c.dispose();
});

test('raw response-byte budget evicts LRU entries, skips oversized responses and accounts for expiry/disposal', async () => {
  let clock = 1000;
  const calls = new Map();
  const fail = new Set();
  const c = client(async url => {
    const id = url.split('/').pop();
    calls.set(id, (calls.get(id) || 0) + 1);
    if (fail.has(id)) return json({ error: 'Synthetic failure after expiry' }, 500);
    return json({ success: true, data: { template_id: id, name: `Fixture ${id}`, description: '文'.repeat(id === '9' ? 500 : 130) } });
  }, { maxCacheEntries: 10, maxCacheBytes: 1024, cacheTtlMs: 100 }, { now: () => clock });
  const one = await c.detail('spell', '1');
  const two = await c.detail('spell', '2');
  assert.equal(c.stats().cacheBytes, one.responseBytes + two.responseBytes);
  assert.equal(c.stats().cacheEntries, 2);
  const three = await c.detail('spell', '3');
  assert.equal(c.stats().cacheBytes, two.responseBytes + three.responseBytes);
  assert.equal(c.stats().cacheEntries, 2, 'third entry exceeds the byte budget even though the entry-count cap is ten');
  await c.detail('spell', '1');
  assert.equal(calls.get('1'), 2, 'first entry was evicted');
  const previousBytes = c.stats().cacheBytes;
  const large = await c.detail('spell', '9');
  assert.ok(large.responseBytes > 1024);
  assert.equal(c.stats().cacheBytes, previousBytes, 'an oversized successful response is not cached');
  await c.detail('spell', '9');
  assert.equal(calls.get('9'), 2);
  clock += 101;
  fail.add('1');
  await assert.rejects(c.detail('spell', '1'), codeIs('http-error'));
  assert.equal(c.stats().cacheBytes, three.responseBytes, 'expired entry bytes are subtracted even if refreshing fails');
  c.dispose();
  assert.equal(c.stats().cacheBytes, 0);
  assert.equal(c.stats().cacheEntries, 0);
});

test('429 Retry-After blocks queued and later work without automatic retries', async () => {
  let clock = 10000;
  let calls = 0;
  const gate = deferred();
  const c = client(async () => { calls++; if (calls === 1) { await gate.promise; return json({ error: SECRET }, 429, { 'Retry-After': '7' }); } return json(entity('1')); }, {}, { now: () => clock });
  const first = c.detail('spell', '1');
  const second = c.detail('spell', '2');
  const results = Promise.allSettled([first, second]);
  gate.resolve();
  const [a, b] = await results;
  assert.equal(a.reason.code, 'rate-limited');
  assert.equal(a.reason.retryAfterMs, 7000);
  assert.equal(b.reason.code, 'cooldown');
  await assert.rejects(c.detail('spell', '1'), codeIs('cooldown'));
  assert.equal(calls, 1);
  clock += 7000;
  await c.detail('spell', '1');
  assert.equal(calls, 2);
  c.dispose();
});

test('503 HTTP-date Retry-After is respected and errors do not echo response secrets', async () => {
  let clock = Date.UTC(2026, 10, 22, 0, 0, 0);
  let calls = 0;
  const c = client(async () => { calls++; return json({ message: SECRET }, 503, { 'Retry-After': new Date(clock + 30000).toUTCString() }); }, {}, { now: () => clock });
  try { await c.detail('spell', '1'); assert.fail('should fail'); } catch (error) {
    assert.equal(error.code, 'unavailable');
    assert.equal(error.retryAfterMs, 30000);
    assert.equal(String(error).includes(SECRET), false);
  }
  await assert.rejects(c.detail('spell', '2'), codeIs('cooldown'));
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(c.stats()).includes(SECRET), false);
  assert.equal('url' in c.stats(), false);
  assert.equal('headers' in c.stats(), false);
  c.dispose();
});

test('401, 403, HTML, invalid JSON, failure envelopes and redirects fail safely once', async () => {
  const cases = [
    [() => json({ error: SECRET }, 401), 'unauthorized'],
    [() => json({ error: SECRET }, 403), 'forbidden'],
    [() => new Response(`<html>${SECRET}</html>`, { headers: { 'Content-Type': 'text/html' } }), 'unexpected-content-type'],
    [() => new Response(`bad json ${SECRET}`, { headers: { 'Content-Type': 'application/json' } }), 'invalid-json'],
    [() => json({ success: false, message: SECRET }), 'api-error'],
    [() => new Response('', { status: 302, headers: { Location: `https://other.example/?token=${SECRET}` } }), 'redirect'],
  ];
  for (const [response, expected] of cases) {
    let calls = 0;
    const c = client(async () => { calls++; return response(); });
    await assert.rejects(c.detail('spell', '1'), error => {
      assert.equal(error.code, expected);
      assert.equal(`${error}\n${error.stack}\n${JSON.stringify(error)}`.includes(SECRET), false);
      return true;
    });
    assert.equal(calls, 1);
    c.dispose();
  }
});

test('response-size bounds apply to headers and streaming bytes', async () => {
  for (const headers of [{}, { 'Content-Length': '1000000' }]) {
    const c = client(async () => json(entity('1'), 200, headers), { maxResponseBytes: 16 });
    await assert.rejects(c.detail('spell', '1'), codeIs('response-too-large'));
    assert.equal(c.stats().cacheEntries, 0);
    c.dispose();
  }
});

test('request and body timeouts settle even when an injected transport ignores abort', async () => {
  const c = client(async () => new Promise(() => {}), { timeoutMs: 10 });
  await assert.rejects(c.detail('spell', '1'), codeIs('timeout'));
  const c2 = client(async () => new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }), { timeoutMs: 10 });
  await assert.rejects(c2.detail('spell', '1'), codeIs('timeout'));
  c.dispose(); c2.dispose();
});

test('queue bounds and disposal reject all callers and clear cached data', async () => {
  const c = client(async () => new Promise(() => {}), { maxQueue: 1 });
  const active = c.detail('spell', '1');
  const queued = c.detail('spell', '2');
  const results = Promise.allSettled([active, queued]);
  await assert.rejects(c.detail('spell', '3'), codeIs('queue-full'));
  c.dispose();
  for (const result of await results) assert.equal(result.reason.code, 'disposed');
  await assert.rejects(c.detail('spell', '1'), codeIs('disposed'));
  assert.equal(c.stats().queued, 0);
  assert.equal(c.stats().inflight, 0);
  assert.equal(c.stats().cacheEntries, 0);
  const cached = client(async () => json(entity('1')));
  await cached.detail('spell', '1');
  cached.dispose();
  assert.equal(cached.stats().cacheEntries, 0);
});

test('disposal interrupts an inter-request delay whose custom clock never advances', async () => {
  let slept = false;
  const c = client(async url => json(entity(url.split('/').pop())), { minIntervalMs: 1200 }, { now: () => 1000, sleep: async () => { slept = true; return new Promise(() => {}); } });
  await c.detail('spell', '1');
  const next = c.detail('spell', '2');
  assert.equal(slept, true);
  c.dispose();
  await assert.rejects(next, codeIs('disposed'));
});

test('network exceptions containing credentials are replaced with static safe errors', async () => {
  const c = client(async () => { throw new Error(`request failed with Authorization: Bearer ${SECRET}`); });
  await assert.rejects(c.detail('spell', '1'), error => error.code === 'network-error' && !`${error}\n${error.stack}`.includes(SECRET));
  c.dispose();
});
