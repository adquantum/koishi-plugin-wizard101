'use strict';

const { ApiError, normalizeType, normalizeId, unwrapDetail, unwrapList, entityName, entityId } = require('./api.cjs');
const format = require('./format.cjs');

function queryText(value) {
  const query = String(value ?? '').normalize('NFKC').trim();
  if (!query) throw new Error('请输入中文名称、英文名称或条目 ID。');
  if (query.length > 180) throw new Error('查询过长，请缩短到 180 个字符以内。');
  if (/[\u0000-\u001f\u007f]/.test(query)) throw new Error('查询不能包含控制字符或换行。');
  return query;
}

function norm(value) { return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim(); }

function sessionKey(session) {
  return JSON.stringify([session?.platform || 'unknown', session?.selfId || '', session?.guildId || '', session?.channelId || 'private', session?.userId || 'anonymous']);
}

class WikiController {
  constructor(config, dict, api) {
    this.config = config;
    this.dict = dict;
    this.api = api;
    this.sessions = new Map();
    this.cooldowns = new Map();
    this.busy = new Set();
    this.closed = false;
  }

  prune() {
    const now = Date.now();
    for (const [key, value] of this.sessions) if (value.expiresAt < now) this.sessions.delete(key);
    for (const [key, value] of this.cooldowns) if (value < now) this.cooldowns.delete(key);
    while (this.sessions.size >= 512) this.sessions.delete(this.sessions.keys().next().value);
    while (this.cooldowns.size >= 1024) this.cooldowns.delete(this.cooldowns.keys().next().value);
  }

  setState(session, value) {
    this.prune();
    this.sessions.set(sessionKey(session), { ...value, expiresAt: Date.now() + 10 * 60 * 1000 });
  }

  async run(session, work) {
    if (this.closed) return '插件已停用。';
    this.prune();
    const key = sessionKey(session);
    if (this.busy.has(key)) return '上一条查询还在处理中，请稍候。';
    const remaining = (this.cooldowns.get(key) || 0) - Date.now();
    if (remaining > 0) return `请在 ${Math.ceil(remaining / 1000)} 秒后继续查询。`;
    this.cooldowns.set(key, Date.now() + this.config.cooldownMs);
    this.busy.add(key);
    try { return await work(); }
    finally { this.busy.delete(key); }
  }

  help() {
    const p = this.config.command;
    return [
      '【Wizard101 中文百科】',
      `${p}.dict 名称  中英互查；加 -f 可扫描长对话`,
      `${p}.spell 法术名  /  ${p}.item 物品名  /  ${p}.mob 怪物名`,
      `${p}.zone 区域名  /  ${p}.npc 人名  /  ${p}.quest 任务名`,
      `${p}.talent 天赋名  /  ${p}.event 活动名`,
      `${p}.search -t spell Fire Cat  指定类别搜索`,
      `${p}.detail mob 1749326  按 ID 查询详情`,
      `${p}.drops 怪物ID  /  ${p}.cheats 怪物ID  /  ${p}.deck 怪物ID`,
      `${p}.recipe 配方ID  查询配方预览`,
      `${p}.compare 物品ID_A 物品ID_B  对比同字段属性`,
      `${p}.where 游戏内部区域路径  精确定位区域`,
      `${p}.pick 1  选择当前列表第1项；${p}.next  翻页`,
      '选项放在名称前。中文名采用本地化包，同名时请先选择。',
      this.config.onlineSearchEnabled ? '在线按名搜索已启用（接口参数待部署端联调确认）。' : '在线按名搜索尚未启用，当前名称查询会返回离线词典；API Key 配置后可使用 ID 查询。',
    ].join('\n');
  }

  dictionary(session, rawQuery, page = 1, note = '', fullText = false) {
    const query = queryText(rawQuery);
    if (!this.dict.stats().entries) {
      this.sessions.delete(sessionKey(session));
      return '尚未导入有效中文词典。请管理员使用 tools/locale/import.cjs 导入自有 WAD/LANG，并设置 localePath。英文在线搜索与 ID 查询不依赖中文词典。';
    }
    const result = this.dict.find(query, { limit: this.config.pageSize, offset: (page - 1) * this.config.pageSize, includeLongText: fullText });
    this.setState(session, { kind: 'dictionary', query, page, total: result.total, items: result.rows, note, fullText });
    return format.dictionary(query, result, page, this.config.pageSize, this.config.command, note);
  }

  async search(session, rawQuery, typeInput = this.config.defaultType, page = 1) {
    const type = normalizeType(typeInput);
    if (!type || !format.LABELS[type]) return '未知类别。可选：item、spell、mob、zone、npc、quest、talent、event、recipe。';
    const query = queryText(rawQuery);
    if (/^\d+$/.test(query)) return this.detail(type, query);
    if (type === 'recipe') return `配方目前仅支持 ID 查询：${this.config.command}.recipe 配方ID。公开规范未提供配方按名搜索接口。`;
    if (!this.config.onlineSearchEnabled) return this.dictionary(session, query, 1, `按名在线查询尚未启用。已知 ID 可用 ${this.config.command}.detail ${type} ID。`);
    const resolution = this.dict.resolve(query, { limit: this.config.pageSize });
    if (!resolution.queries.length) return this.dictionary(session, query, 1, '没有确定的英文对应名，因此没有向 API 发送猜测名称。可选择英文全名或添加俗称别名。');
    if (resolution.ambiguous || resolution.queries.length > 1) {
      this.setState(session, { kind: 'terms', type, query, items: resolution.queries });
      return format.choices(query, resolution.queries, type, this.config.command);
    }
    return this.searchEnglish(session, query, resolution.queries[0], type, page);
  }

  async searchEnglish(session, query, english, type, page, previousFingerprints = []) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) return '页码必须是 1 到 10000 之间的整数。';
    const result = await this.api.search(type, english, page);
    const list = unwrapList(result.body, type);
    const seen = new Set();
    const wanted = norm(english);
    const items = list.items.filter(item => {
      const id = entityId(item), name = norm(entityName(item));
      if (!id || !name || !name.includes(wanted) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const fingerprint = list.items.map(entityId).filter(Boolean).sort().join(',');
    if (fingerprint && previousFingerprints.includes(fingerprint)) {
      const old = this.sessions.get(sessionKey(session));
      if (old) old.nextPage = null;
      return '接口返回了重复页面，已停止翻页。请管理员核对 pageParam 和接口分页方式。';
    }
    // A server that ignores q must never turn an unrelated page into a successful match.
    const nextPage = list.items.length && Number.isInteger(list.nextPage) && list.nextPage > page ? list.nextPage : null;
    this.setState(session, { kind: 'search', query, english, type, page, items, nextPage, fingerprints: [...previousFingerprints, fingerprint].slice(-32) });
    return format.searchResults(query, english, type, items, { ...list, nextPage }, page, this.config.command, this.dict, result, list.items.length - items.length);
  }

  async detail(typeInput, rawId) {
    const type = normalizeType(typeInput);
    if (!type || !format.LABELS[type]) return '未知条目类别。';
    const id = normalizeId(rawId);
    const result = await this.api.detail(type, id);
    const entity = unwrapDetail(result.body, type);
    const actualId = entityId(entity);
    if (actualId && actualId !== id) return '接口返回的 ID 与请求不一致，已停止显示。请管理员检查 API 契约。';
    return format.detail(type, id, entity, result, this.dict, this.config.command);
  }

  async pick(session, rawIndex) {
    const index = Number(rawIndex);
    const state = this.sessions.get(sessionKey(session));
    if (!state || state.expiresAt < Date.now()) return '没有当前搜索结果，或结果已过期。请先查询。';
    if (!Number.isInteger(index) || index < 1 || index > state.items.length) return `请选择 1 到 ${state.items.length} 之间的序号。`;
    const item = state.items[index - 1];
    if (state.kind === 'dictionary') return format.dictionaryEntry(item);
    if (state.kind === 'terms') return this.searchEnglish(session, state.query, item, state.type, 1);
    return this.detail(state.type, entityId(item));
  }

  async next(session) {
    const state = this.sessions.get(sessionKey(session));
    if (!state || state.expiresAt < Date.now()) return '没有当前搜索结果，或结果已过期。请先查询。';
    if (state.kind === 'dictionary') {
      if (state.page * this.config.pageSize >= state.total) return '已经是最后一页。';
      return this.dictionary(session, state.query, state.page + 1, state.note, state.fullText);
    }
    if (state.kind !== 'search') return '请先用 pick 选择一个英文名称。';
    if (state.nextPage === null) return '来源未提供下一页，已经停止翻页。';
    return this.searchEnglish(session, state.query, state.english, state.type, state.nextPage, state.fingerprints);
  }

  async relation(rawId, relationType) {
    const id = normalizeId(rawId);
    const result = await this.api.relation(id, relationType);
    const body = result.body;
    if (body?.success === false) throw new ApiError('response-error', '来源返回错误，暂时无法显示。');
    const data = body && Object.hasOwn(body, 'data') ? body.data : body;
    if (!data || typeof data !== 'object') return '接口返回结构不符合预期，未将其当作百科数据。';
    return format.relation(id, relationType, data, result, this.dict);
  }

  async lookup(rawPath) {
    const objectName = queryText(rawPath);
    const result = await this.api.lookupZone(objectName);
    const entity = unwrapDetail(result.body, 'zone');
    const id = entityId(entity);
    if (!id) return '区域查询响应中没有有效 ID，请管理员检查响应结构。';
    return format.detail('zone', id, entity, result, this.dict, this.config.command);
  }

  async compare(leftInput, rightInput) {
    const leftId = normalizeId(leftInput), rightId = normalizeId(rightInput);
    const leftResult = await this.api.detail('item', leftId);
    const rightResult = await this.api.detail('item', rightId);
    const left = unwrapDetail(leftResult.body, 'item'), right = unwrapDetail(rightResult.body, 'item');
    if ((entityId(left) && entityId(left) !== leftId) || (entityId(right) && entityId(right) !== rightId)) return '接口返回了不匹配的物品 ID，已停止对比。';
    return format.compare(leftId, left, rightId, right, this.dict);
  }

  status() {
    const s = this.dict.stats(), a = this.api.stats();
    return [
      '【Wizard101 插件状态】',
      `本地化记录：${s.entries ?? s.totalEntries ?? '已加载'}`,
      `简繁检索：${s.scriptConversion ? '已启用' : '按原文匹配'}`,
      `API Key：${this.config.apiKey ? '已配置' : '未配置'}`,
      `在线按名搜索：${this.config.onlineSearchEnabled ? '已启用，待实际联调确认' : '未启用'}`,
      `缓存条目：${a.cacheEntries ?? a.cacheSize ?? 0}`,
      '公开版使用合成 HTTP 夹具测试；远程接口请用 probe-api 工具在部署环境验证。',
    ].join('\n');
  }

  dispose() {
    this.closed = true;
    this.sessions.clear();
    this.cooldowns.clear();
    this.busy.clear();
    this.api.dispose();
    this.dict.dispose();
  }
}

module.exports = { WikiController, queryText, sessionKey, norm };
