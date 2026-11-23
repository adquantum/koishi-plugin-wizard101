'use strict';

// Real Koishi Session accessors, Discord 4.6.2 adaptSession/Internal, and QQ
// 4.14.0 encoder. The transport below is entirely in memory: no live messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Context, h } = require('koishi');
const { Discord, DiscordBot } = require('@satorijs/adapter-discord');
const { QQMessageEncoder } = require('@satorijs/adapter-qq');
const { createNativeInteractions, buildDiscordCommands, parseDiscordCommand, buildQQInputButtons, TTL_MS } = require('../lib/interactions.cjs');

const APP = '101000000000000001';
const GUILD = '201000000000000001';
const CHANNEL = '301000000000000001';
const USER = '401000000000000001';
const OTHER_USER = '401000000000000002';
const BIG_ID = '4611686020152371460';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64');

function memoryTransport() {
  const calls = [], commands = new Map(), originals = new Map();
  let sequence = 501000000000000000n;
  const nextId = () => String(sequence++);
  const api = { calls, commands, originals, failImage: false, failAllEdits: false, pauseEdit: null };
  api.http = async (method, url, { data } = {}) => {
    const json = data instanceof FormData ? JSON.parse(data.get('payload_json')) : data;
    calls.push({ method, url, data, json: json && structuredClone(json) });
    const commandRoute = /^\/applications\/(\d+)(?:\/guilds\/(\d+))?\/commands(?:\/(\d+))?$/.exec(url);
    if (commandRoute) {
      const scope = commandRoute[2] || '';
      const values = commands.get(scope) || [];
      commands.set(scope, values);
      if (method === 'GET') return { data: structuredClone(values) };
      if (method === 'POST') {
        assert.equal(values.some(value => value.name === data.name && value.type === 1), false, 'create must never upsert an existing name');
        const command = { ...structuredClone(data), id: nextId(), application_id: commandRoute[1] };
        values.push(command); return { data: command };
      }
      if (method === 'PATCH') {
        const index = values.findIndex(value => value.id === commandRoute[3]);
        assert.ok(index >= 0);
        values[index] = { ...structuredClone(data), id: commandRoute[3], application_id: commandRoute[1] };
        return { data: values[index] };
      }
      assert.fail(`Unexpected command mutation: ${method}`);
    }
    if (/^\/interactions\/\d+\/[^/]+\/callback$/.test(url)) { assert.equal(method, 'POST'); return { data: null }; }
    const original = /^\/webhooks\/\d+\/([^/]+)\/messages\/@original$/.exec(url);
    if (original) {
      assert.equal(method, 'PATCH');
      if (api.failAllEdits) throw new Error('Authorization: Bearer synthetic-transport-secret');
      if (data instanceof FormData && api.failImage) { api.failImage = false; throw new Error('private-upload-secret'); }
      if (api.pauseEdit) { const pause = api.pauseEdit; api.pauseEdit = null; await pause(); }
      const previous = originals.get(original[1]) || { id: nextId() };
      const message = { ...previous, ...structuredClone(json), channel_id: CHANNEL };
      originals.set(original[1], message);
      return { data: message };
    }
    if (/^\/webhooks\/\d+\/[^/]+$/.test(url)) { assert.equal(method, 'POST'); return { data: { id: nextId(), ...json } }; }
    assert.fail(`Unstubbed request ${method} ${url}`);
  };
  api.http.isError = () => false;
  return api;
}

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wizard101-interactions-'));
  const ctx = new Context();
  const transport = memoryTransport();
  const warnings = [];
  const bot = Object.create(DiscordBot.prototype);
  Object.assign(bot, { ctx, context: ctx, user: { id: APP, name: 'Synthetic Wiki Bot' }, platform: 'discord', commands: [], config: { slash: false }, http: transport.http, callbacks: {}, logger: { warn: value => warnings.push(value), debug() {} } });
  bot.internal = new Discord.Internal(bot);
  const executed = [];
  const clock = { time: 1000000, timers: new Map(), next: 1 };
  const manager = createNativeInteractions({
    registryPath: path.join(directory, 'commands.json'),
    async execute(session, route, params) {
      executed.push({ session, route, params });
      return { kind: 'wizard101.reply', pages: [{ text: '合成资料甲' }, { text: '合成资料乙' }, { text: '合成资料丙' }] };
    },
    logger: bot.logger, now: () => clock.time,
    setTimer(callback, milliseconds) { const id = clock.next++; clock.timers.set(id, { callback, milliseconds }); return id; },
    clearTimer(id) { clock.timers.delete(id); },
    ...options,
  });
  t.after(async () => { await manager.dispose(); await ctx.stop(); await fs.rm(directory, { recursive: true, force: true }); });
  return { directory, ctx, bot, transport, manager, warnings, executed, clock };
}

function commandData(f, route = 'item.find', values = { name: BIG_ID }, { userId = USER, guildId = GUILD, channelId = CHANNEL, scope = '', token = 'synthetic-command-token' } = {}) {
  const specs = buildDiscordCommands({ commandName: f.manager.commandName });
  const parts = route.split('.');
  let rootName = f.manager.commandName || parts[0];
  let spec = specs.find(command => command.name === rootName);
  const branch = f.manager.commandName ? spec.options.find(option => option.name === parts[0]) : spec;
  const leaf = parts.length > 1 ? branch.options.find(option => option.name === parts[1]) : branch;
  const params = Object.entries(values).map(([name, value]) => ({ name, type: leaf.options.find(option => option.name === name).type, value }));
  let options = parts.length > 1 ? [{ name: parts[1], type: 1, options: params }] : params;
  if (f.manager.commandName) options = [{ name: parts[0], type: parts.length > 1 ? 2 : 1, options }];
  const command = f.transport.commands.get(scope).find(entry => entry.name === rootName);
  return { id: '601000000000000001', type: 2, application_id: APP, token, channel_id: channelId,
    ...(guildId ? { guild_id: guildId, member: { user: { id: userId, username: '测试用户' } } } : { user: { id: userId, username: '测试用户' } }),
    data: { id: command.id, name: rootName, type: 1, options },
  };
}

function originalPatches(f) { return f.transport.calls.filter(call => call.method === 'PATCH' && call.url.endsWith('/messages/@original')); }
function followups(f) { return f.transport.calls.filter(call => call.method === 'POST' && /^\/webhooks\//.test(call.url)); }
function callbackCalls(f) { return f.transport.calls.filter(call => call.url.endsWith('/callback')); }
function firstState(f) { return f.manager.sessions.values().next().value; }

async function button(f, action, state = firstState(f), overrides = {}, throughEvent = false) {
  const data = { id: '701000000000000001', type: 3, application_id: APP, token: 'synthetic-click-token', channel_id: CHANNEL, guild_id: GUILD, member: { user: { id: USER } }, message: { id: state?.messageId || '999' }, data: { custom_id: `w101p:${state?.id || '0'.repeat(24)}:${action}`, component_type: 2 }, ...overrides };
  const session = await Discord.adaptSession(f.bot, { t: 'INTERACTION_CREATE', d: data });
  assert.equal(session.type, 'interaction/button');
  if (throughEvent) await f.ctx.parallel(session, 'interaction/button', session);
  else await f.manager.handleDiscordButton(session);
  return session;
}

test('all 15 upstream routes and every argument exist in both command layouts with Chinese labels', () => {
  const expected = {
    'item.find': ['name', 'school', 'kind', 'level', 'search_by'], 'item.list': ['name', 'school', 'kind', 'level'],
    'spell.find': ['name', 'school', 'kind', 'rank', 'search_by', 'show_spell_effects', 'num_targets'], 'spell.list': ['name', 'school', 'kind', 'rank'],
    'mob.find': ['name', 'school', 'kind', 'rank', 'search_by'], 'mob.list': ['name', 'school', 'kind', 'rank'], 'mob.deck': ['name', 'school', 'kind', 'rank', 'search_by'], 'mob.calc': ['name', 'school', 'base', 'damage', 'pierce', 'critical', 'buffs', 'pvp', 'search_by'],
    'pet.find': ['name', 'school', 'wow', 'exclusive', 'search_by'], 'pet.list': ['name', 'school', 'wow', 'exclusive'],
    'fish.find': ['name', 'school', 'rank', 'is_sentinel', 'search_by'], 'fish.list': ['name', 'school', 'rank', 'is_sentinel', 'use_object_name'],
    'statcaps.find': ['level', 'school'], calc: ['base', 'damage', 'pierce', 'critical', 'resist', 'block', 'buffs', 'pvp'], help: [],
  };
  for (const commandName of ['', 'wiz']) {
    const commands = buildDiscordCommands({ commandName });
    assert.equal(commands.length, commandName ? 1 : 8);
    const roots = commandName ? commands[0].options : commands;
    const found = {};
    for (const root of roots) {
      assert.ok(root.name_localizations['zh-CN']);
      const leaves = ['calc', 'help'].includes(root.name) ? [root] : root.options;
      for (const leaf of leaves) {
        const route = ['calc', 'help'].includes(root.name) ? root.name : `${root.name}.${leaf.name}`;
        found[route] = leaf.options.map(option => option.name);
        let optionalSeen = false;
        for (const option of leaf.options) {
          assert.ok(!Object.hasOwn(option, 'defaultValue'));
          assert.match(option.description, /[\u4e00-\u9fff]/);
          assert.ok(option.name_localizations['zh-TW']);
          assert.ok(!option.choices || option.choices.length <= 25);
          if (!option.required) optionalSeen = true;
          else assert.equal(optionalSeen, false, `${route}: required options must precede optional options`);
        }
      }
    }
    assert.deepEqual(found, expected);
  }
  const parsed = parseDiscordCommand({ name: 'fish', options: [{ name: 'find', type: 1, options: [{ name: 'name', type: 3, value: BIG_ID }, { name: 'is_sentinel', type: 5, value: false }, { name: 'search_by', type: 3, value: 'ID' }] }] });
  assert.equal(parsed.params.name, BIG_ID);
  assert.equal(parsed.params.is_sentinel, false);
  assert.equal(parsed.params.rank, -1);
  assert.throws(() => parseDiscordCommand({ name: 'calc', options: [] }), /必填/);
  assert.throws(() => buildDiscordCommands({ commandName: '@everyone' }), /命名空间/);
});

test('explicit sync creates/edits only registered IDs, persists ownership, and rejects all name collisions before writing', async t => {
  const f = await fixture(t);
  f.manager.attach(f.ctx);
  assert.equal(f.transport.calls.length, 0, 'attaching listeners must not register or send anything');
  f.transport.commands.set('', [{ name: 'weather', type: 1, id: '80001', description: 'Foreign plugin' }]);
  const result = await f.manager.syncDiscord(f.bot);
  assert.equal(result.created.length, 8);
  assert.equal(result.scope, 'global');
  const disk = JSON.parse(await fs.readFile(path.join(f.directory, 'commands.json'), 'utf8'));
  assert.equal(disk.commands.length, 8);
  assert.doesNotMatch(JSON.stringify(disk), /token|secret/);
  assert.equal((await f.manager.syncDiscord(f.bot)).updated.length, 8);
  assert.deepEqual(f.transport.commands.get('')[0], { name: 'weather', type: 1, id: '80001', description: 'Foreign plugin' });
  assert.equal(f.transport.calls.some(call => ['DELETE', 'PUT'].includes(call.method)), false);
  f.transport.commands.set(GUILD, [{ name: 'help', id: '80002' }]);
  const before = f.transport.calls.length;
  await assert.rejects(f.manager.syncDiscord(f.bot, { guildId: GUILD }), /其他命令/);
  assert.deepEqual(f.transport.calls.slice(before).map(call => call.method), ['GET']);
  const restarted = createNativeInteractions({ registryPath: path.join(f.directory, 'commands.json'), execute: async () => '再见' });
  t.after(() => restarted.dispose());
  assert.equal((await restarted.syncDiscord(f.bot)).updated.length, 8);
  f.bot.config.slash = true;
  await assert.rejects(f.manager.syncDiscord(f.bot), /slash.*false/);
});

test('real adapter event flow acknowledges commands once and buttons once, then edits the same original message', async t => {
  const f = await fixture(t);
  f.manager.attach(f.ctx);
  await f.manager.syncDiscord(f.bot, { guildId: GUILD });
  const command = commandData(f, 'item.list', { name: '*', school: 'Fire', level: 170 }, { scope: GUILD });
  await f.ctx.parallel('discord/interaction-create', command, f.bot);
  assert.equal(await Discord.adaptSession(f.bot, { t: 'INTERACTION_CREATE', d: command }), undefined, 'adapter ignores commands outside bot.commands');
  assert.equal(f.executed.length, 1);
  assert.equal(f.executed[0].route, 'item.list');
  assert.equal(f.executed[0].session.userId, USER);
  assert.equal(f.executed[0].session.channelId, CHANNEL);
  assert.equal(f.executed[0].session.platform, 'discord');
  assert.equal(f.executed[0].params.school, 'Fire');
  assert.deepEqual(callbackCalls(f).map(call => call.json.type), [5]);
  const state = firstState(f);
  assert.deepEqual(originalPatches(f).at(-1).json.components[0].components.map(component => component.disabled), [true, true, false, false]);
  for (const [action, index] of [['next', 1], ['last', 2], ['prev', 1], ['first', 0]]) {
    await button(f, action, state, {}, true);
    assert.equal(state.index, index);
  }
  assert.equal(f.executed.length, 1, 'pagination must not repeat an upstream query');
  assert.deepEqual(callbackCalls(f).map(call => call.json.type), [5, 6, 6, 6, 6]);
  assert.equal(new Set(originalPatches(f).map(call => call.url)).size, 1);
  assert.equal(f.transport.originals.size, 1);
  assert.equal(followups(f).length, 0);
});

test('user, channel, and original-message checks prevent others from taking over a paginator', async t => {
  const f = await fixture(t);
  await f.manager.syncDiscord(f.bot);
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  const state = firstState(f), before = originalPatches(f).length;
  for (const changed of [{ member: { user: { id: OTHER_USER } } }, { channel_id: '301000000000000009' }, { message: { id: '900000000000000009' } }]) await button(f, 'last', state, changed);
  assert.equal(state.index, 0);
  assert.equal(originalPatches(f).length, before);
  assert.equal(followups(f).length, 3);
  for (const call of followups(f)) { assert.equal(call.json.flags, 64); assert.deepEqual(call.json.allowed_mentions, { parse: [] }); }
  await f.manager.handleDiscordCommand(commandData(f, 'pet.find', { name: 'other' }, { userId: OTHER_USER, token: 'second-query-token' }), f.bot);
  const other = [...f.manager.sessions.values()][1];
  await button(f, 'last', state);
  assert.equal(state.index, 2);
  assert.equal(other.index, 0);
  assert.equal(f.transport.originals.size, 2);
});

test('180-second expiry disables every button and late clicks receive an explicit private expiry message', async t => {
  const f = await fixture(t);
  await f.manager.syncDiscord(f.bot);
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  const state = firstState(f);
  assert.equal([...f.clock.timers.values()][0].milliseconds, TTL_MS);
  f.clock.time += TTL_MS;
  await [...f.clock.timers.values()][0].callback();
  assert.equal(f.manager.sessions.size, 0);
  assert.equal(state.token, '');
  assert.equal(originalPatches(f).at(-1).json.components[0].components.every(component => component.disabled), true);
  assert.match(originalPatches(f).at(-1).json.content, /已过期/);
  const count = originalPatches(f).length;
  await button(f, 'next', state);
  assert.equal(originalPatches(f).length, count);
  assert.match(followups(f).at(-1).json.content, /已过期/);
});

test('lazy lists jump directly to the last page without constructing every page', async t => {
  const loaded = [];
  const f = await fixture(t, { commandName: 'wiz', execute: async () => ({ kind: 'wizard101.reply', pageCount: 200000, async getPage(index) { loaded.push(index); return { text: `合成名称 ${index}` }; } }) });
  await f.manager.syncDiscord(f.bot);
  assert.equal(f.transport.commands.get('').length, 1);
  await f.manager.handleDiscordCommand(commandData(f, 'fish.list', { name: '*', use_object_name: true }), f.bot);
  const state = firstState(f);
  assert.deepEqual(loaded, [0]);
  await button(f, 'last', state);
  assert.deepEqual(loaded, [0, 199999]);
  assert.equal(state.index, 199999);
  assert.match(originalPatches(f).at(-1).json.content, /200000\/200000/);
  for (let i = 0; i < 4; i++) await button(f, 'prev', state);
  assert.ok(state.cache.size <= 3);
  assert.equal(loaded.length, 6);
});

test('native PNGs redact before rendering, escape Markdown and mentions, and fall back only once without another query', async t => {
  const rendered = [], key = 'synthetic-private-key';
  let executions = 0;
  const f = await fixture(t, {
    redact: value => value.replaceAll(key, '[已隐藏]'),
    execute: async () => { executions++; return { kind: 'wizard101.reply', pages: [{ text: `[显示文字](https://example.invalid/) @everyone <@123> ${key} w404_dev_SYNTHETIC_PRIVATE`, card: { title: key, sections: [] } }] }; },
    renderPage: async page => { rendered.push(page); return { content: page.text, png: PNG }; },
  });
  await f.manager.syncDiscord(f.bot);
  f.transport.failImage = true;
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  assert.equal(executions, 1);
  assert.equal(rendered.length, 1);
  assert.doesNotMatch(JSON.stringify(rendered), /synthetic-private-key|w404_dev_SYNTHETIC_PRIVATE/);
  const requests = originalPatches(f);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].data instanceof FormData);
  assert.equal(requests[0].data.get('files[0]').size, PNG.length);
  assert.equal(requests[1].data instanceof FormData, false);
  assert.deepEqual(requests[1].json.attachments, []);
  assert.match(requests[1].json.content, /图卡发送失败/);
  assert.match(requests[1].json.content, /\\\[显示文字\\\]\\\(/);
  assert.doesNotMatch(requests[1].json.content, /@everyone|<@123>|synthetic-private-key|w404_dev_SYNTHETIC_PRIVATE/);
  assert.deepEqual(requests[1].json.allowed_mentions, { parse: [] });
  assert.doesNotMatch(f.warnings.join('\n'), /private-upload-secret|synthetic-private-key/);
});

test('an overlong Markdown/emoji page remains fully reachable through text subpages', async t => {
  const original = '起点' + '*[]😀'.repeat(700) + '完整结尾';
  const pages = [];
  const f = await fixture(t, {
    execute: async () => ({ kind: 'wizard101.reply', pageCount: 1, getPage: () => ({ text: original }) }),
    renderPage: async page => { pages.push(page.text); return { content: page.text }; },
  });
  await f.manager.syncDiscord(f.bot);
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  const state = firstState(f);
  assert.ok(state.parts.length > 1);
  while (state.part < state.parts.length - 1) await button(f, 'next', state);
  assert.equal(pages.join(''), original);
  for (const request of originalPatches(f)) assert.ok(request.json.content.length <= 2000, `Discord content length ${request.json.content.length}`);
  assert.match(originalPatches(f).at(-1).json.content, /完整结尾/);
  assert.equal(state.pageCount, 1);
});

test('a rejected image and rejected fallback do not trigger a third edit or another data query', async t => {
  let executions = 0;
  const f = await fixture(t, {
    execute: async () => { executions++; return { kind: 'wizard101.reply', pages: [{ text: '合成资料' }] }; },
    renderPage: async page => ({ content: page.text, png: PNG }),
  });
  await f.manager.syncDiscord(f.bot);
  f.transport.failAllEdits = true;
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  assert.equal(originalPatches(f).length, 2);
  assert.equal(executions, 1);
  assert.equal(f.manager.sessions.size, 0);
  assert.doesNotMatch(f.warnings.join('\n'), /synthetic-transport-secret|Authorization/);
});

test('expiry cannot be undone by a page edit that was already in flight', async t => {
  const f = await fixture(t);
  await f.manager.syncDiscord(f.bot);
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  const state = firstState(f);
  let unblock, entered;
  const inFlight = new Promise(resolve => { entered = resolve; });
  f.transport.pauseEdit = () => { entered(); return new Promise(resolve => { unblock = resolve; }); };
  const clicking = button(f, 'next', state);
  await inFlight;
  f.clock.time += TTL_MS;
  const expiring = f.manager.expire(state);
  unblock();
  await Promise.all([clicking, expiring]);
  assert.equal(f.manager.sessions.size, 0);
  const last = originalPatches(f).at(-1).json;
  assert.equal(last.components[0].components.every(component => component.disabled), true);
  assert.match(last.content, /已过期/);
  assert.match(last.content, /合成资料乙/);
});

test('query and render exceptions never expose raw credentials or transport errors', async t => {
  const f = await fixture(t, { execute: async () => { throw new Error('Authorization: Bearer synthetic-private-error'); } });
  await f.manager.syncDiscord(f.bot);
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  assert.match(originalPatches(f).at(-1).json.content, /查询未完成/);
  assert.doesNotMatch(JSON.stringify(originalPatches(f).map(call => call.json)) + f.warnings.join(''), /synthetic-private-error|Authorization/);
  f.manager.execute = async () => ({ kind: 'wizard101.reply', pages: [{ text: '可读文字' }] });
  f.manager.renderPage = () => { throw new Error('/private/secret/font.ttf'); };
  await f.manager.handleDiscordCommand(commandData(f), f.bot);
  assert.match(originalPatches(f).at(-1).json.content, /可读文字/);
  assert.doesNotMatch(f.warnings.join(''), /secret|font\.ttf/);
});

test('QQ input buttons are opt-in and the real official group encoder produces four command-input actions', async () => {
  assert.deepEqual(buildQQInputButtons({ platform: 'qq' }), []);
  assert.deepEqual(buildQQInputButtons({ platform: 'qqguild' }, { enabled: true }), []);
  assert.deepEqual(buildQQInputButtons({ platform: 'discord' }, { enabled: true }), []);
  const posts = [];
  const bot = {
    config: { retryWhen: [], intents: 0 }, ctx: { http: {} }, http: { isError: () => false },
    session: () => ({ event: { message: {} }, app: { emit() {} }, channelId: CHANNEL, guildId: CHANNEL, isDirect: false }),
    internal: { async sendMessage(id, payload) { posts.push(payload); return { id: '90001', timestamp: new Date().toISOString() }; } },
  };
  const encoder = new QQMessageEncoder(bot, CHANNEL, null, { session: { messageId: '90002', timestamp: Date.now(), userId: USER } });
  encoder.session = bot.session();
  await encoder.render([h.text('点击后发送对应翻页指令。'), ...buildQQInputButtons({ platform: 'qq' }, { enabled: true })]);
  await encoder.flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].msg_type, 2);
  assert.equal(posts[0].msg_id, '90002');
  const buttons = posts[0].keyboard.content.rows[0].buttons;
  assert.deepEqual(buttons.map(button => button.action.type), [2, 2, 2, 2]);
  assert.deepEqual(buttons.map(button => button.action.data), ['wiz.first', 'wiz.prev', 'wiz.next', 'wiz.last']);
});
