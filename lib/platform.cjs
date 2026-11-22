'use strict';

const { h } = require('koishi');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IMAGE_PLATFORMS = new Set(['qq', 'qqguild', 'discord']);
// adapter-qq 4.14.0 still drops passive IDs at this age, even though QQ's
// current group/C2C API permits a longer window. Never turn that into a push.
const QQ_PASSIVE_WINDOW_MS = 5 * 60 * 1000 - 2000;

function getPlatform(session) {
  return String(session?.platform || session?.event?.platform || session?.bot?.platform || '').toLowerCase();
}

function positiveInteger(value, fallback, ceiling) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, ceiling) : fallback;
}

function neutralizeMentions(text, platform) {
  const value = String(text ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  if (platform !== 'discord') return value;
  return value
    .replace(/@(everyone|here)\b/gi, '@\u200b$1')
    .replace(/<@([!&]?\d+)>/g, '<@\u200b$1>');
}

function textCost(value, platform) {
  // The official Discord encoder escapes Markdown after h.text() is parsed.
  // Count that expansion before applying Discord's content limit.
  if (platform !== 'discord') return value.length;
  return value.length + (value.match(/[\\*_`~|()\[\]]/g) || []).length;
}

function takeTextBudget(value, budget, platform) {
  let result = '';
  let used = 0;
  for (const character of value) {
    const cost = textCost(character, platform);
    if (used + cost > budget) break;
    used += cost;
    result += character;
  }
  return result;
}

function continuationCommand(options) {
  const command = /^[a-z][a-z0-9.-]{0,63}$/.test(options.pageCommand || '') ? options.pageCommand : 'wiz.page';
  const page = positiveInteger(options.nextPage, 2, 10000);
  return `${command} ${page}`;
}

function limitText(text, limit, platform, command = 'wiz.page 2') {
  const value = neutralizeMentions(text, platform);
  if (textCost(value, platform) <= limit) return value;
  const suffix = `\n……\n文字未显示完整，输入 ${command} 查看后续。`;
  return takeTextBudget(value, Math.max(0, limit - textCost(suffix, platform)), platform).trimEnd() + suffix;
}

function textLimit(platform, options) {
  const requested = platform === 'discord' ? options.discordTextLimit : options.qqTextLimit;
  // Leave room below Discord's 2000-character limit. QQ uses the same
  // conservative default without claiming it is the platform's hard limit.
  return Math.max(120, positiveInteger(requested, 1800, platform === 'discord' ? 1900 : 5000));
}

function imageBuffer(value, options) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) return null;
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const maxBytes = positiveInteger(options.maxImageBytes, 2097152, 8388608);
  if (buffer.length > maxBytes || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return buffer;
}

function stripSummaryUrls(text) {
  return text
    .replace(/https?:\/\/[^\s<>"'\u3000]+/gi, '')
    .replace(/www\.[^\s<>"'\u3000]+/gi, '')
    .replace(/^[ \t]*(?:来源|原文|source)\s*[:：]?[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Build only Koishi elements: external strings never become message markup. */
function buildReply(session, reply = {}, options = {}) {
  const platform = getPlatform(session);
  const mode = ['auto', 'text', 'image'].includes(options.mode) ? options.mode : 'auto';
  const canImage = mode === 'image' || (mode === 'auto' && IMAGE_PLATFORMS.has(platform));
  const png = canImage ? imageBuffer(reply.png, options) : null;
  const completeText = neutralizeMentions(reply.text || '暂无可显示的资料。', platform);
  const limit = textLimit(platform, options);
  const next = continuationCommand(options);

  if (!png || mode === 'text') {
    return [h.text(limitText(completeText, limit, platform, next))];
  }

  let summary = neutralizeMentions(reply.summary === undefined ? completeText : reply.summary, platform);
  if (platform === 'qq' && options.qqStripSummaryUrls !== false) summary = stripSummaryUrls(summary);
  if (!summary.trim()) summary = '资料卡已生成，来源见图卡。';
  if (textCost(completeText, platform) > limit && textCost(summary, platform) <= limit) {
    summary += `\n文字较长，输入 ${next} 查看后续。`;
  }
  const caption = h.text(limitText(summary, limit, platform, next));
  const image = h.image(png, 'image/png');
  // QQ group/C2C flushes the previous text when it encounters an image;
  // Discord attaches preceding text to the image upload. QQGuild's encoder
  // always separates these into two messages; keep its text first.
  return platform === 'qq' ? [image, caption] : [caption, image];
}

function hasCurrentQQSession(session) {
  const platform = getPlatform(session);
  if (platform !== 'qq' && platform !== 'qqguild') return true;
  const timestamp = Number(session?.timestamp ?? session?.event?.timestamp);
  return Boolean(session?.messageId ?? session?.event?.message?.id) && Number.isFinite(timestamp) && timestamp > 0
    && Date.now() - timestamp < QQ_PASSIVE_WINDOW_MS;
}

function log(options, message) {
  try { options.logger?.warn?.(message); } catch (_) { /* logging must not alter delivery */ }
}

/** Send only through the current session. A failed image gets one text fallback. */
async function sendReply(session, reply = {}, options = {}) {
  if (!session || typeof session.send !== 'function') throw new Error('当前会话不能发送消息。');
  if (!hasCurrentQQSession(session)) {
    log(options, 'QQ 被动回复会话缺失或已过期，已跳过发送；请用户重新发起查询。');
    return [];
  }
  const elements = buildReply(session, reply, options);
  const withImage = elements.some(element => element.type === 'img' || element.type === 'image');
  try {
    const result = await session.send(elements);
    // The official QQ/Discord encoders produce message IDs after successful
    // delivery. The official mock adapter intentionally returns no IDs, and
    // other forced-image adapters may do the same, so do not infer failure there.
    if (withImage && IMAGE_PLATFORMS.has(getPlatform(session)) && Array.isArray(result) && !result.length) throw new Error('Image delivery returned no message.');
    return result;
  } catch (_) {
    if (!withImage) {
      log(options, '文字消息发送失败，请检查平台连接与发送权限。');
      throw new Error('文字消息发送失败，请检查平台连接与发送权限。');
    }
    log(options, '图片消息发送失败，尝试一次文字回退。');
    if (!hasCurrentQQSession(session)) {
      log(options, 'QQ 被动回复会话已过期，已取消文字回退。');
      return [];
    }
    const fallback = buildReply(session, {
      text: `图片发送失败，以下为文字资料。\n${String(reply.text || '暂无可显示的资料。')}`,
    }, { ...options, mode: 'text' });
    try {
      return await session.send(fallback);
    } catch (_) {
      log(options, '文字回退发送失败，请检查平台连接与发送权限。');
      throw new Error('消息发送失败，请检查平台连接与发送权限。');
    }
  }
}

module.exports = {
  buildReply, sendReply, getPlatform, neutralizeMentions, textCost, limitText,
  hasCurrentQQSession, QQ_PASSIVE_WINDOW_MS,
};
