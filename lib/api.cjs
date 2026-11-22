'use strict';

// Routes are documented at https://wizard404.com/api/v1/docs.
// See docs/api-contract.md for the verified routes and verification limits.
// Success envelopes and search parameter defaults are compatibility adapters,
// not claims that an authenticated production request has been verified.

class ApiError extends Error {
  constructor(code, message, details = {}) {
    super(message || 'Wizard404 请求失败。');
    this.name = 'ApiError';
    this.code = code;
    if (Number.isInteger(details.status)) this.status = details.status;
    if (Number.isFinite(details.retryAfterMs)) this.retryAfterMs = Math.max(0, details.retryAfterMs);
  }
}

function normalizeId(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ApiError('invalid-id', '条目 ID 必须是完整十进制字符串，不能使用已丢失精度的数字。');
    }
    value = String(value);
  }
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value.trim())) {
    throw new ApiError('invalid-id', '条目 ID 必须是 1–40 位非负十进制整数。');
  }
  return value.trim().replace(/^0+(?=\d)/, '');
}

const TYPES = Object.freeze(Object.fromEntries([
  ['item', 'items', '物品', '/items'],
  ['spell', 'spells', '法术', '/spells/search'],
  ['mob', 'mobs', '怪物', '/mobs/search'],
  ['zone', 'zones', '区域', '/zones/search'],
  ['npc', 'npcs', 'NPC', '/npcs/search'],
  ['quest', 'quests', '任务', '/quests/search'],
  ['talent', 'talents', '天赋', '/talents/search'],
  ['event', 'events', '活动', '/events/search'],
  ['recipe', 'recipes', '配方', null],
].map(([type, plural, label, searchPath]) => [type, Object.freeze({
  plural, label,
  detailPath: (id) => `/${plural}/${normalizeId(id)}${type === 'recipe' ? '/preview' : ''}`,
  ...(searchPath ? { searchPath } : {}),
})])));

const TYPE_ALIASES = Object.freeze({
  item: 'item', items: 'item', gear: 'item', equipment: 'item', 物品: 'item', 装备: 'item', 道具: 'item',
  spell: 'spell', spells: 'spell', 法术: 'spell', 法術: 'spell', 卡牌: 'spell',
  mob: 'mob', mobs: 'mob', boss: 'mob', 怪物: 'mob', 怪: 'mob', 首领: 'mob', 首領: 'mob',
  zone: 'zone', zones: 'zone', 区域: 'zone', 區域: 'zone', 地点: 'zone', 地點: 'zone', 地图: 'zone', 地圖: 'zone',
  npc: 'npc', npcs: 'npc', 人物: 'npc',
  quest: 'quest', quests: 'quest', 任务: 'quest', 任務: 'quest',
  talent: 'talent', talents: 'talent', pet_talent: 'talent', 天赋: 'talent', 天賦: 'talent',
  event: 'event', events: 'event', 活动: 'event', 活動: 'event',
  recipe: 'recipe', recipes: 'recipe', 配方: 'recipe',
});

function normalizeType(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const result = Object.hasOwn(TYPE_ALIASES, key) ? TYPE_ALIASES[key] : undefined;
  if (!result) throw new ApiError('invalid-type', '不支持此条目类别。可用：物品、法术、怪物、区域、NPC、任务、天赋、活动、配方。');
  return result;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** JSON.parse without rounding unsafe integer tokens. Quoted text is untouched. */
function parseJsonLossless(text) {
  if (typeof text !== 'string') throw new ApiError('invalid-json', 'API 未返回有效 JSON 文本。');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i++] === '"') break;
      }
      out += text.slice(start, i);
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const start = i;
      if (text[i] === '-') i++;
      if (text[i] === '0') i++;
      else while (text[i] >= '0' && text[i] <= '9') i++;
      if (text[i] === '.') {
        i++;
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      if (i === start) i++;
      const token = text.slice(start, i);
      // Let JSON.parse reject malformed tokens rather than repairing them.
      const valid = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token);
      const number = Number(token);
      const unsafe = valid && (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number)));
      out += unsafe ? JSON.stringify(token) : token;
      continue;
    }
    out += c;
    i++;
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new ApiError('invalid-json', 'API 返回了无效 JSON；可能是访问拦截页或接口响应变化。');
  }
}

function rejectFailureEnvelope(body) {
  if (isRecord(body) && (body.success === false || (Number.isInteger(body.code) && body.code >= 400))) {
    throw new ApiError('api-error', 'API 返回失败结果；请检查访问权限或稍后重试。', {
      status: Number.isInteger(body.code) && body.code <= 599 ? body.code : undefined,
    });
  }
}

function entityName(entity) {
  if (!isRecord(entity)) return '';
  for (const field of ['display_name', 'name', 'title', 'displayName']) {
    if (typeof entity[field] === 'string' && entity[field].trim()) return entity[field].trim();
  }
  return '';
}

function entityId(entity) {
  if (!isRecord(entity)) return null;
  for (const field of ['template_id', 'templateId', 'id']) {
    if (entity[field] === undefined || entity[field] === null) continue;
    // Do not silently ignore a rounded template_id and use a different ID field.
    return normalizeId(entity[field]);
  }
  return null;
}

function unwrapDetail(body) {
  rejectFailureEnvelope(body);
  if (!isRecord(body)) throw new ApiError('unexpected-shape', 'API 详情结构未识别，未将其当作百科条目。');
  if (Object.hasOwn(body, 'data')) {
    if (body.data === null) throw new ApiError('not-found', '未找到该条目。');
    if (isRecord(body.data) && Object.keys(body.data).length) return body.data;
    throw new ApiError('unexpected-shape', 'API 详情的 data 不是有效条目对象。');
  }
  if (['template_id', 'templateId', 'id', 'name', 'display_name', 'parsed_data'].some(key => Object.hasOwn(body, key))) return body;
  throw new ApiError('unexpected-shape', 'API 详情结构未识别，未将其当作百科条目。');
}

function unwrapList(body, type) {
  rejectFailureEnvelope(body);
  const normalizedType = type === undefined ? null : normalizeType(type);
  const plural = normalizedType ? TYPES[normalizedType].plural : null;
  const data = isRecord(body) ? body.data : undefined;
  const candidates = [body, data];
  for (const scope of [body, data]) {
    if (!isRecord(scope)) continue;
    candidates.push(scope.items, scope.results);
    if (plural) candidates.push(scope[plural]);
  }
  const items = candidates.find(Array.isArray);
  if (!items || !items.every(isRecord)) {
    throw new ApiError('unexpected-shape', 'API 搜索结果结构未识别，未显示可能无关的列表。');
  }
  const scopes = [];
  for (const scope of [body, data]) {
    if (!isRecord(scope)) continue;
    if (isRecord(scope.pagination)) scopes.push(scope.pagination);
    if (isRecord(scope.meta)) scopes.push(scope.meta);
    scopes.push(scope);
  }
  const readInt = (keys) => {
    for (const scope of scopes) for (const key of keys) {
      const value = scope[key];
      if (Number.isSafeInteger(value) && value >= 0) return value;
      if (typeof value === 'string' && /^\d{1,15}$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
    }
    return null;
  };
  return {
    items,
    total: readInt(['total', 'total_count']),
    page: readInt(['page', 'current_page']),
    totalPages: readInt(['total_pages', 'pages']),
    nextPage: readInt(['next_page']),
  };
}

function normalizeBaseUrl(value) {
  const raw = String(value || 'https://wizard404.com/api/v1').trim();
  let url;
  try { url = new URL(raw); } catch { throw new ApiError('invalid-config', 'API 基址必须是有效的 HTTPS URL。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || /\/\/[^/]*@/.test(raw)
    || raw.includes('?') || raw.includes('#') || raw.includes('\\')) {
    throw new ApiError('invalid-config', 'API 基址需要 HTTPS，不能带账号、密码、查询参数或锚点；HTTP 仅用于本机测试。');
  }
  return { baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, loopback };
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ApiError('invalid-config', 'API 数值配置超出有效范围。');
  }
  return value;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new ApiError('disposed', '插件已停止。')); return; }
    const abort = () => { clearTimeout(timer); reject(new ApiError('disposed', '插件已停止。')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function headerValue(response, name) {
  return response.headers && typeof response.headers.get === 'function' ? response.headers.get(name) : null;
}

async function abortable(promise, signal) {
  if (signal.aborted) throw new Error('Aborted request');
  let abort;
  const interrupted = new Promise((resolve, reject) => {
    abort = () => reject(new Error('Aborted request'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener('abort', abort); }
}

function retryDelay(value, now, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const v = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(v)) {
    const milliseconds = Number(v) * 1000;
    if (Number.isFinite(milliseconds)) return Math.max(0, Math.ceil(Math.min(milliseconds, Number.MAX_SAFE_INTEGER - now)));
    return Number.MAX_SAFE_INTEGER - now;
  }
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.max(0, date - now) : fallback;
}

async function readLimitedBody(response, maxBytes, controller) {
  const lengthHeader = headerValue(response, 'content-length');
  if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > maxBytes) {
    controller.abort();
    throw new ApiError('response-too-large', 'API 响应超过大小上限，请缩小查询范围。');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await abortable(response.text(), controller.signal);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ApiError('response-too-large', 'API 响应超过大小上限。');
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), controller.signal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new ApiError('response-too-large', 'API 响应超过大小上限，请缩小查询范围。');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    if (controller.signal.aborted) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

class Wizard404Client {
  constructor(config = {}, options = {}) {
    const base = normalizeBaseUrl(config.baseUrl);
    this._baseUrl = base.baseUrl;
    this._apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
    if (this._apiKey && !/^[\x21-\x7e]{1,512}$/.test(this._apiKey)) {
      throw new ApiError('invalid-config', 'API Key 格式无效。');
    }
    this._authMode = config.authMode || 'bearer';
    if (!['bearer', 'x-api-key'].includes(this._authMode)) throw new ApiError('invalid-config', '认证方式必须是 bearer 或 x-api-key。');
    this._userAgent = typeof config.userAgent === 'string' ? config.userAgent.trim() : '';
    if (/[\r\n\x00]/.test(this._userAgent) || this._userAgent.length > 512) throw new ApiError('invalid-config', 'User-Agent 格式无效。');
    this._timeoutMs = boundedInteger(config.timeoutMs, 12000, 1, 120000);
    const interval = boundedInteger(config.minIntervalMs, 1200, 0, 60000);
    this._minIntervalMs = base.loopback ? interval : Math.max(1200, interval);
    this._cacheTtlMs = boundedInteger(config.cacheTtlMs, 900000, 0, 86400000);
    this._maxCacheEntries = boundedInteger(config.maxCacheEntries, 128, 1, 10000);
    this._maxCacheBytes = boundedInteger(config.maxCacheBytes, 16777216, 1024, 134217728);
    this._maxResponseBytes = boundedInteger(config.maxResponseBytes, 4194304, 1, 33554432);
    this._maxQueue = boundedInteger(config.maxQueue, 12, 1, 100);
    this._onlineSearchEnabled = config.onlineSearchEnabled === true;
    this._searchParam = config.searchParam === undefined ? 'q' : config.searchParam;
    this._pageParam = config.pageParam === undefined ? 'page' : config.pageParam;
    this._pageSizeParam = config.pageSizeParam === undefined ? 'limit' : config.pageSizeParam;
    for (const param of [this._searchParam, this._pageParam]) {
      if (typeof param !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(param)) throw new ApiError('invalid-config', '搜索参数名必须是简短字母数字标识符。');
    }
    if (typeof this._pageSizeParam !== 'string' || (this._pageSizeParam !== '' && !/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(this._pageSizeParam))) throw new ApiError('invalid-config', '页大小参数名需要字母数字标识符，或留空以省略该参数。');
    const parameterNames = [this._searchParam, this._pageParam, this._pageSizeParam].filter(Boolean);
    if (new Set(parameterNames).size !== parameterNames.length) throw new ApiError('invalid-config', '查询、页码、页大小的参数名不能重复。');
    this._pageSize = boundedInteger(config.pageSize, 8, 1, 100);
    this._fetch = options.fetch || globalThis.fetch;
    if (typeof this._fetch !== 'function') throw new ApiError('invalid-config', '需要 Node.js 18 或更新版本的 fetch 支持。');
    this._now = options.now || Date.now;
    this._sleep = options.sleep || defaultSleep;
    this._cache = new Map();
    this._cacheBytes = 0;
    this._inflight = new Map();
    this._controllers = new Set();
    this._queue = [];
    this._processing = false;
    this._disposed = false;
    this._lastStartedAt = -Infinity;
    this._cooldownUntil = 0;
    this._requests = 0;
    this._cacheHits = 0;
    this._coalesced = 0;
  }

  async detail(type, id) {
    type = normalizeType(type);
    id = normalizeId(id);
    return this._request(TYPES[type].detailPath(id), undefined, (body) => {
      const entity = unwrapDetail(body);
      const actual = entityId(entity);
      if (actual !== null && actual !== id) throw new ApiError('id-mismatch', 'API 返回的条目 ID 与请求不一致，已停止显示该结果。');
    });
  }

  async search(type, query, page = 1) {
    type = normalizeType(type);
    if (!this._onlineSearchEnabled) throw new ApiError('search-disabled', '在线名称搜索尚未启用：请先验证 API 查询参数，再由管理员开启。中文词条与已绑定 ID 查询仍可使用。');
    if (!TYPES[type].searchPath) throw new ApiError('unsupported-search', '官方文档未提供此类别的名称搜索接口；请使用条目 ID。');
    if (typeof query !== 'string' || !query.trim() || query.trim().length > 200 || /[\x00-\x1f]/.test(query)) throw new ApiError('invalid-query', '搜索关键词需要 1–200 个字符，且不能包含控制字符。');
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new ApiError('invalid-page', '页码必须是 1–10000 的整数。');
    const params = {
      [this._searchParam]: query.trim(),
      [this._pageParam]: String(page),
    };
    if (this._pageSizeParam) params[this._pageSizeParam] = String(this._pageSize);
    return this._request(TYPES[type].searchPath, params, body => { unwrapList(body, type); });
  }

  async relation(mobId, relation) {
    mobId = normalizeId(mobId);
    if (!['drops', 'cheats', 'deck'].includes(relation)) throw new ApiError('invalid-relation', '仅支持怪物掉落、机制和牌组查询。');
    return this._request(`/mobs/${mobId}/${relation}`);
  }

  async lookupZone(objectName) {
    if (typeof objectName !== 'string' || !objectName.trim() || objectName.length > 512 || /[\x00-\x1f]/.test(objectName)) throw new ApiError('invalid-query', '内部区域路径需要 1–512 个字符。');
    return this._request('/zones/lookup', { object_name: objectName.trim() });
  }

  _ensureAccess() {
    if (this._disposed) throw new ApiError('disposed', '插件已停止，请重新启用后再查询。');
    if (!this._apiKey) throw new ApiError('missing-key', '尚未配置 Wizard404 API Key。离线中文词条仍可查询。');
    if (!this._userAgent || !/(https?:\/\/\S+|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)/.test(this._userAgent)) throw new ApiError('user-agent', '请在 User-Agent 中填写工具名称和联系方式（邮箱或网址）。');
  }

  _cooldownError() {
    return new ApiError('cooldown', 'Wizard404 要求等待后再请求，冷却期间不会重试。', { retryAfterMs: this._cooldownUntil - this._now() });
  }

  _request(path, params, validate) {
    try { this._ensureAccess(); } catch (error) { return Promise.reject(error); }
    // Enforce the read-only allowlist again at the transport boundary.
    const safePath = /^\/(?:items|spells|mobs|zones|npcs|quests|talents|events)\/\d{1,40}$/.test(path)
      || /^\/recipes\/\d{1,40}\/preview$/.test(path)
      || /^\/mobs\/\d{1,40}\/(?:drops|cheats|deck)$/.test(path)
      || path === '/zones/lookup'
      || Object.values(TYPES).some(type => type.searchPath === path);
    if (!safePath) return Promise.reject(new ApiError('invalid-route', '该路径不在只读百科接口允许列表内。'));
    const url = new URL(`${this._baseUrl}${path}`);
    if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const key = url.href;
    const cached = this._cache.get(key);
    if (cached) {
      if (cached.expiresAt > this._now()) {
        this._cache.delete(key);
        this._cache.set(key, cached);
        this._cacheHits++;
        return Promise.resolve({ body: cached.body, fetchedAt: cached.fetchedAt, url: key, cacheHit: true, responseBytes: cached.responseBytes });
      }
      this._removeCached(key);
    }
    if (this._cooldownUntil > this._now()) return Promise.reject(this._cooldownError());
    if (this._inflight.has(key)) {
      this._coalesced++;
      return this._inflight.get(key);
    }
    if (this._queue.length >= this._maxQueue) return Promise.reject(new ApiError('queue-full', '查询队列已满，请稍后再试。'));
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this._inflight.set(key, promise);
    this._queue.push({ key, validate, resolve, reject });
    void this._drain();
    return promise;
  }

  async _wait(ms, signal) {
    if (signal.aborted || this._disposed) throw new ApiError('disposed', '插件已停止。');
    // A custom test sleep need not implement AbortSignal. Race it so dispose
    // still settles every caller even if that test clock has stopped.
    let abort;
    const interrupted = new Promise((resolve, reject) => {
      abort = () => reject(new ApiError('disposed', '插件已停止。'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try { await Promise.race([this._sleep(ms, signal), interrupted]); }
    finally { signal.removeEventListener('abort', abort); }
  }

  _removeCached(key) {
    const cached = this._cache.get(key);
    if (!cached) return;
    this._cache.delete(key);
    this._cacheBytes -= cached.responseBytes;
  }

  async _drain() {
    if (this._processing) return;
    this._processing = true;
    try {
      while (this._queue.length) {
        const job = this._queue.shift();
        const controller = new AbortController();
        this._controllers.add(controller);
        try {
          if (this._disposed) throw new ApiError('disposed', '插件已停止。');
          if (this._cooldownUntil > this._now()) throw this._cooldownError();
          const waitMs = Math.max(0, this._lastStartedAt + this._minIntervalMs - this._now());
          if (waitMs > 0) await this._wait(waitMs, controller.signal);
          if (this._disposed) throw new ApiError('disposed', '插件已停止。');
          if (this._cooldownUntil > this._now()) throw this._cooldownError();
          this._lastStartedAt = this._now();
          this._requests++;
          const result = await this._perform(job, controller);
          if (this._disposed) throw new ApiError('disposed', '插件已停止。');
          if (this._cacheTtlMs > 0 && result.responseBytes <= this._maxCacheBytes) {
            this._removeCached(job.key);
            this._cache.set(job.key, { ...result, expiresAt: this._now() + this._cacheTtlMs });
            this._cacheBytes += result.responseBytes;
            while (this._cache.size > this._maxCacheEntries || this._cacheBytes > this._maxCacheBytes) this._removeCached(this._cache.keys().next().value);
          }
          job.resolve(result);
        } catch (error) {
          job.reject(error instanceof ApiError ? error : new ApiError('network-error', '无法连接 Wizard404，请检查网络或 API 配置。'));
        } finally {
          this._controllers.delete(controller);
          this._inflight.delete(job.key);
        }
      }
    } finally { this._processing = false; }
  }

  async _perform(job, controller) {
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this._timeoutMs);
    const headers = { Accept: 'application/json', 'User-Agent': this._userAgent };
    if (this._authMode === 'x-api-key') headers['X-API-Key'] = this._apiKey;
    else headers.Authorization = `Bearer ${this._apiKey}`;
    try {
      const response = await abortable(this._fetch(job.key, { method: 'GET', headers, redirect: 'manual', signal: controller.signal }), controller.signal);
      if (this._disposed) throw new ApiError('disposed', '插件已停止。');
      if (response.status >= 300 && response.status <= 399) throw new ApiError('redirect', 'API 返回重定向；为保护密钥，本次请求未继续跟随。', { status: response.status });
      if (response.status === 401) throw new ApiError('unauthorized', 'API Key 未通过认证；请更新密钥，本次请求不会自动重试。', { status: 401 });
      if (response.status === 403) throw new ApiError('forbidden', 'Wizard404 拒绝访问；请检查密钥角色、接口权限或站点访问限制。', { status: 403 });
      if (response.status === 404) throw new ApiError('not-found', 'Wizard404 未找到该条目。', { status: 404 });
      if (response.status === 429 || response.status === 503) {
        const delay = retryDelay(headerValue(response, 'retry-after'), this._now(), response.status === 429 ? 60000 : 30000);
        this._cooldownUntil = Math.max(this._cooldownUntil, this._now() + delay);
        throw new ApiError(response.status === 429 ? 'rate-limited' : 'unavailable', response.status === 429 ? 'Wizard404 请求频率受限，请按提示等待。' : 'Wizard404 暂时不可用，请按提示等待。', { status: response.status, retryAfterMs: delay });
      }
      if (!response.ok) throw new ApiError('http-error', 'Wizard404 返回服务错误，请稍后重试。', { status: response.status });
      const contentType = (headerValue(response, 'content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (contentType && contentType !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(contentType)) throw new ApiError('unexpected-content-type', 'API 返回的内容不是 JSON，可能是站点访问拦截页。');
      const raw = await readLimitedBody(response, this._maxResponseBytes, controller);
      const body = parseJsonLossless(raw);
      if (!isRecord(body) && !Array.isArray(body)) throw new ApiError('unexpected-shape', 'API 返回的 JSON 不是对象或列表。');
      rejectFailureEnvelope(body);
      if (job.validate) job.validate(body);
      return { body, cacheHit: false, fetchedAt: this._now(), url: job.key, responseBytes: Buffer.byteLength(raw, 'utf8') };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (this._disposed) throw new ApiError('disposed', '插件已停止。');
      if (timedOut) throw new ApiError('timeout', 'Wizard404 请求超时，本次请求未自动重试。');
      throw new ApiError('network-error', '无法连接 Wizard404，请检查网络或 API 配置。');
    } finally {
      clearTimeout(timer);
      // Release unread response bodies (including error/redirect responses).
      controller.abort();
    }
  }

  stats() {
    return {
      cacheEntries: this._cache.size,
      cacheBytes: this._cacheBytes,
      inflight: this._inflight.size,
      queued: this._queue.length,
      requests: this._requests,
      cacheHits: this._cacheHits,
      coalesced: this._coalesced,
      cooldownMs: Math.max(0, this._cooldownUntil - this._now()),
      disposed: this._disposed,
      keyConfigured: Boolean(this._apiKey),
      onlineSearchEnabled: this._onlineSearchEnabled,
    };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const controller of this._controllers) controller.abort();
    for (const job of this._queue.splice(0)) {
      job.reject(new ApiError('disposed', '插件已停止。'));
      this._inflight.delete(job.key);
    }
    this._cache.clear();
    this._cacheBytes = 0;
  }
}

module.exports = { Wizard404Client, ApiError, parseJsonLossless, normalizeId, TYPES, normalizeType, unwrapDetail, unwrapList, entityName, entityId };
