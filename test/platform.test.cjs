'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReply, sendReply, textCost, hasCurrentQQSession, QQ_PASSIVE_WINDOW_MS } = require('../lib/platform.cjs');

// Synthetic transparent 1x1 PNG; no game image is included in tests.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
const text = elements => elements.filter(element => element.type === 'text').map(element => element.attrs.content).join('');
const hasImage = elements => elements.some(element => element.type === 'img');

test('QQ groups/C2C place the PNG before the caption and omit summary URLs', () => {
  const result = buildReply({ platform: 'qq' }, {
    png: PNG,
    text: '示例资料\n来源：https://wizard404.com/items/1',
    summary: '示例物品\n来源：https://wizard404.com/items/1',
  });
  assert.deepEqual(result.map(element => element.type), ['img', 'text']);
  assert.equal(result[0].attrs.src, `data:image/png;base64,${PNG.toString('base64')}`);
  assert.equal(text(result), '示例物品');
});

test('Discord and QQGuild place text before the PNG; QQGuild may emit two messages', () => {
  for (const platform of ['discord', 'qqguild']) {
    const result = buildReply({ platform }, { png: PNG, text: '完整资料', summary: '示例卡片' });
    assert.deepEqual(result.map(element => element.type), ['text', 'img']);
    assert.equal(text(result), '示例卡片');
  }
});

test('text mode and unknown auto platforms keep text, while forced image supports mock', () => {
  assert.equal(hasImage(buildReply({ platform: 'discord' }, { png: PNG, text: '资料' }, { mode: 'text' })), false);
  assert.equal(hasImage(buildReply({ platform: 'onebot' }, { png: PNG, text: '资料' })), false);
  assert.equal(hasImage(buildReply({ platform: 'mock' }, { png: PNG, text: '资料' }, { mode: 'image' })), true);
  assert.equal(hasImage(buildReply({ bot: { platform: 'discord' } }, { png: PNG, text: '资料' })), true);
});

test('untrusted text remains text and Discord mass/user/role mentions are neutralized', () => {
  const value = '<at type="all"/><img src="https://evil.invalid/a"/> @everyone @here <@123> <@!123> <@&123> [safe](https://evil.invalid)';
  const result = buildReply({ platform: 'discord' }, { text: value });
  assert.equal(result.length, 1);
  assert.equal(result[0].type, 'text');
  assert.match(String(result[0]), /&lt;at/);
  assert.doesNotMatch(text(result), /@everyone|@here|<@[!&]?\d+>/);
  assert.match(text(result), /@\u200beveryone/);
  assert.match(text(result), /\[safe\]\(https:\/\/evil\.invalid\)/);
});

test('invalid, non-PNG, and oversized images fall back to the available text', () => {
  for (const png of ['https://remote.invalid/icon.png', Buffer.from('<svg/>'), Buffer.from('iVBORw0K'), PNG]) {
    const result = buildReply({ platform: 'qq' }, { png, text: '可用文字' }, { maxImageBytes: 8 });
    assert.equal(hasImage(result), false);
    assert.equal(text(result), '可用文字');
  }
  assert.equal(hasImage(buildReply({ platform: 'qq' }, { png: new Uint8Array(PNG), text: '资料' })), true);
});

test('Discord truncation budgets encoder Markdown escaping and preserves surrogate pairs', () => {
  const result = buildReply({ platform: 'discord' }, { text: '\\*_`~|()[]🧙'.repeat(500) });
  const value = text(result);
  assert.ok(textCost(value, 'discord') <= 1800);
  assert.match(value, /文字未显示完整/);
  assert.match(value, /wiz\.page 2/);
  assert.equal(value.isWellFormed(), true);
});

test('long text and long image captions expose an actionable custom continuation', () => {
  const options = { qqTextLimit: 140, pageCommand: 'wiki.page', nextPage: 3 };
  const complete = '很长的完整资料'.repeat(100);
  const plain = text(buildReply({ platform: 'qq' }, { text: complete }, options));
  assert.ok(plain.length <= 140);
  assert.match(plain, /wiki\.page 3/);
  const shortCaption = text(buildReply({ platform: 'qq' }, { png: PNG, text: complete, summary: '资料卡' }, options));
  assert.match(shortCaption, /文字较长/);
  assert.match(shortCaption, /wiki\.page 3/);
  const longCaption = text(buildReply({ platform: 'qq' }, { png: PNG, text: complete, summary: complete }, options));
  assert.ok(longCaption.length <= 140);
  assert.match(longCaption, /文字未显示完整/);
});

test('text mode retains source links and image captions can explicitly keep them', () => {
  const payload = { png: PNG, text: '来源：https://wizard404.com/items/1' };
  assert.match(text(buildReply({ platform: 'qq' }, payload, { mode: 'text' })), /https:\/\/wizard404/);
  assert.match(text(buildReply({ platform: 'qq' }, payload, { qqStripSummaryUrls: false })), /https:\/\/wizard404/);
});

test('one successful image reply uses only the current session once', async () => {
  const calls = [];
  const session = { platform: 'discord', async send(elements) { calls.push(elements); return ['sent']; } };
  assert.deepEqual(await sendReply(session, { png: PNG, text: '资料' }), ['sent']);
  assert.equal(calls.length, 1);
  assert.equal(hasImage(calls[0]), true);
});

test('image send failure triggers one text fallback without disclosing transport errors', async () => {
  const calls = [], warnings = [];
  const session = { platform: 'discord', async send(elements) {
    calls.push(elements);
    if (calls.length === 1) throw new Error('secret-token-and-local-path');
    return ['fallback'];
  } };
  assert.deepEqual(await sendReply(session, { png: PNG, text: '原始资料' }, { logger: { warn: value => warnings.push(value) } }), ['fallback']);
  assert.equal(calls.length, 2);
  assert.equal(hasImage(calls[1]), false);
  assert.match(text(calls[1]), /原始资料/);
  assert.doesNotMatch(warnings.join('\n'), /secret-token|local-path/);
});

test('an empty image result triggers fallback, but a failed text send is not retried', async () => {
  const calls = [];
  const session = { platform: 'discord', async send(elements) { calls.push(elements); return calls.length === 1 ? [] : ['fallback']; } };
  assert.deepEqual(await sendReply(session, { png: PNG, text: '资料' }), ['fallback']);
  assert.equal(calls.length, 2);
  let attempts = 0;
  await assert.rejects(sendReply({ platform: 'discord', async send() { attempts++; throw new Error('private'); } }, { text: '资料' }), /^Error: 文字消息发送失败/);
  assert.equal(attempts, 1);
});

test('a forced-image mock returning no IDs is not mistaken for a failed delivery', async () => {
  let attempts = 0;
  const session = { platform: 'mock', async send() { attempts++; return []; } };
  assert.deepEqual(await sendReply(session, { png: PNG, text: '资料' }, { mode: 'image' }), []);
  assert.equal(attempts, 1);
});

test('two failed attempts expose only a generic message', async () => {
  let attempts = 0;
  const warnings = [];
  await assert.rejects(sendReply({ platform: 'discord', async send() {
    attempts++; throw new Error('private-token');
  } }, { png: PNG, text: '资料' }, { logger: { warn: value => warnings.push(value) } }), error => !error.message.includes('private-token'));
  assert.equal(attempts, 2);
  assert.doesNotMatch(warnings.join('\n'), /private-token/);
});

test('QQ missing or expired passive context never becomes an active push', async () => {
  for (const platform of ['qq', 'qqguild']) {
    for (const context of [{}, { messageId: 'incoming' }, { timestamp: Date.now() }, { messageId: 'incoming', timestamp: Date.now() - QQ_PASSIVE_WINDOW_MS - 1 }]) {
      let calls = 0;
      const session = { platform, ...context, async send() { calls++; } };
      assert.deepEqual(await sendReply(session, { png: PNG, text: '资料' }), []);
      assert.equal(calls, 0);
    }
  }
  assert.equal(hasCurrentQQSession({ platform: 'qq', messageId: 'incoming', timestamp: Date.now() }), true);
});

test('QQ context expiring during a failed image upload cancels the fallback', async () => {
  let calls = 0;
  const session = { platform: 'qq', messageId: 'incoming', timestamp: Date.now(), async send() {
    calls++;
    this.timestamp = Date.now() - QQ_PASSIVE_WINDOW_MS - 1;
    throw new Error('upload-timeout');
  } };
  assert.deepEqual(await sendReply(session, { png: PNG, text: '资料' }), []);
  assert.equal(calls, 1);
});

test('passive QQ guards accept canonical Satori event fields and real Session accessors', () => {
  const { Session } = require('@satorijs/core');
  const event = { platform: 'qq', timestamp: Date.now(), message: { id: 'incoming' } };
  assert.equal(hasCurrentQQSession({ event }), true);
  const session = Object.create(Session.prototype);
  session.event = event;
  assert.equal(session.platform, 'qq');
  assert.equal(session.timestamp, event.timestamp);
  assert.equal(session.messageId, 'incoming');
  assert.equal(hasCurrentQQSession(session), true);
});

function optionalAdapter(name) {
  try { return require(name); }
  catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.startsWith(`Cannot find module '${name}'`)) return null;
    throw error;
  }
}

const qqAdapter = optionalAdapter('@satorijs/adapter-qq');
const discordAdapter = optionalAdapter('@satorijs/adapter-discord');
function encodedSession() {
  return { event: { message: {} }, app: { emit() {} }, channelId: 'group', guildId: 'group', isDirect: false };
}
const decodeSyntheticImage = async src => ({ filename: 'card.png', type: 'image/png', data: Buffer.from(src.split(',')[1], 'base64') });

test('official QQ encoder builds one passive media request using the local PNG', { skip: !qqAdapter && 'Install @satorijs/adapter-qq@4.14.0 to verify its encoder.' }, async () => {
  const posts = [], uploads = [];
  const bot = {
    config: { uploadThreshold: 3000000, retryWhen: [], intents: 0 }, ctx: { http: {} }, http: { isError: () => false }, session: encodedSession,
    internal: {
      async sendFileGuild(id, data) { uploads.push(data); return { file_info: 'synthetic-file', ttl: 10 }; },
      async sendMessage(id, data) { posts.push(data); return { id: 'qq-result', timestamp: new Date().toISOString() }; },
    },
  };
  const encoder = new qqAdapter.QQMessageEncoder(bot, 'group', null, { session: { messageId: 'incoming', timestamp: Date.now(), userId: 'user' } });
  encoder.session = encodedSession();
  await encoder.render(buildReply({ platform: 'qq' }, { text: '卡片摘要', png: PNG }));
  await encoder.flush();
  assert.equal(posts.length, 1);
  assert.equal(uploads[0].file_data, PNG.toString('base64'));
  assert.equal(uploads[0].srv_send_msg, false);
  assert.equal(posts[0].msg_type, 7);
  assert.equal(posts[0].msg_id, 'incoming');
  assert.equal(posts[0].msg_seq, 1);
  assert.equal(posts[0].content, '卡片摘要');
});

test('official Discord encoder builds one multipart PNG attachment and neutralized caption', { skip: !discordAdapter && 'Install @satorijs/adapter-discord@4.6.2 to verify its encoder.' }, async () => {
  const posts = [];
  const encoder = new discordAdapter.DiscordMessageEncoder({
    config: { handleMixedContent: 'attach' }, ctx: { http: { file: decodeSyntheticImage } }, http: { isLocal: async () => true },
  }, 'channel', null, {});
  encoder.post = async data => { posts.push(data); return {}; };
  await encoder.render(buildReply({ platform: 'discord' }, { text: '卡片摘要 @everyone <@123>', png: PNG }));
  await encoder.flush();
  assert.equal(posts.length, 1);
  assert.ok(posts[0] instanceof FormData);
  assert.equal(posts[0].get('files[0]').size, PNG.length);
  assert.equal(JSON.parse(posts[0].get('payload_json')).content, '卡片摘要 @\u200beveryone <@\u200b123>');
});

test('official QQGuild encoder emits two passive replies for a caption and PNG', { skip: !qqAdapter && 'Install @satorijs/adapter-qq@4.14.0 to verify its encoder.' }, async () => {
  const posts = [];
  const bot = {
    config: { parent: { intents: 0 } }, parent: { config: { retryWhen: [] } }, logger: { debug() {} },
    ctx: { http: { isLocal: async () => true, file: decodeSyntheticImage } },
    http: { isError: () => false, async post(url, data) { posts.push(data); return { id: 'guild-image' }; } },
    internal: { async sendMessage(id, data) { posts.push(data); return { id: 'guild-text' }; } }, session: encodedSession,
  };
  const encoder = new qqAdapter.QQGuildMessageEncoder(bot, 'channel', null, { session: { messageId: 'incoming', timestamp: Date.now() } });
  encoder.session = encodedSession();
  await encoder.render(buildReply({ platform: 'qqguild' }, { text: '卡片摘要', png: PNG }));
  await encoder.flush();
  assert.equal(posts.length, 2);
  assert.equal(posts[0].content, '卡片摘要');
  assert.ok(posts[1] instanceof FormData);
  assert.equal(posts[1].get('msg_id'), 'incoming');
});
