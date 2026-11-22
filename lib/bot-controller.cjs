'use strict';

const { WikiController, queryText, sessionKey } = require('./controller.cjs');
const { ApiError, normalizeId, normalizeType, entityId, unwrapDetail } = require('./api.cjs');
const { LocalCatalog, LOCAL_ONLY, catalogType, normalizeFilters, schoolName } = require('./catalog.cjs');
const { calculateDamage, formatDamageReport, CalculationError } = require('./calculators.cjs');
const views = require('./views.cjs');
const format = require('./format.cjs');
const { getPlatform, textCost, neutralizeMentions } = require('./platform.cjs');

function buffList(value, name) {
  if (value === undefined || value === '') return [];
  const pieces = String(value).split(/[,，]/).map(v => v.trim());
  if (pieces.length > 16 || pieces.some(v => !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(v))) throw new CalculationError(`${name}需要用逗号分隔的非负数字，最多 16 项，例如 40,35。`);
  return pieces.map(Number);
}

function damageInput(base, options = {}) {
  const result = { base: Number(base) };
  const mapping = { damage: 'damagePercent', flatDamage: 'flatDamage', resist: 'resistPercent', flatResist: 'flatResist', pierce: 'piercePercent', critical: 'criticalMultiplier' };
  for (const [key, dest] of Object.entries(mapping)) if (options[key] !== undefined) result[dest] = Number(options[key]);
  for (const key of ['blades', 'weaknesses', 'traps', 'shields']) if (options[key] !== undefined) result[key] = buffList(options[key], key);
  return result;
}

class BotController extends WikiController {
  constructor(config, dict, api, catalog = new LocalCatalog()) {
    super(config, dict, api);
    this.catalog = catalog;
    this.responses = new Map();
    this.dataSource = config.dataSource || 'hybrid';
  }

  help() {
    const p = this.config.command;
    return super.help() + '\n\n【图鉴与本地资料】\n' + [
      `${p}.gear 名称  装备查询（同 item）`,
      `${p}.pet 名称  / ${p}.fish 名称  本地宠物与鱼类资料`,
      `${p}.list -t item -s fire -l 170  按学派/等级筛选本地资料`,
      `${p}.statcaps fire 170  本地等级属性上限`,
      `${p}.calc 1000 -d 100 -b 40,35 -r 20 -p 10  单段伤害估算`,
      `${p}.mobcalc 怪物ID 1000 -s fire -d 100  使用明确百分比抗性估算`,
      `${p}.prev / ${p}.first / ${p}.last  查询结果上一/首/末页`,
      `${p}.page 2  查看当前详情或图卡第 2 页`,
      '图片模式由管理员配置；缺字体或渲染失败时使用文字。',
    ].join('\n');
  }

  missingCatalog(type) {
    return `尚未导入${views.LABELS[type]}资料。请管理员用 tools/catalog/from-sqlite.py 导入自己的 wizdb items.db，或准备 wizard101.catalog JSON，并设置 catalogPath。图标和汉化词典只提供图像/译名，不包含这类游戏属性。`;
  }

  async search(session, rawQuery, typeInput = this.config.defaultType, page = 1, options = {}) {
    const type = catalogType(typeInput);
    const query = queryText(rawQuery);
    const filters = normalizeFilters(options);
    if (/^\d+$/.test(query) && !options.object) return this.detail(type, query, options);
    if (!options.remote && (this.dataSource !== 'api' || LOCAL_ONLY.has(type)) && this.catalog.has(type)) {
      const resolution = options.object ? { queries: [] } : this.dict.resolve(query, { limit: 10 });
      const queries = [query, ...resolution.queries];
      return this.localSearch(session, query, type, queries, filters, page, false);
    }
    if (LOCAL_ONLY.has(type) || this.dataSource === 'local') return this.missingCatalog(type);
    if (Object.keys(filters).length) return '这些筛选只用于本地资料包。当前公开 API 参数尚未确认，不会发送猜测的学派、类型或等级筛选；请先导入资料包，或去掉筛选使用在线按名查询。';
    const output = await super.search(session, query, type, page);
    const state = this.sessions.get(sessionKey(session));
    if (state && ['terms', 'search'].includes(state.kind)) state.remote = true;
    return output;
  }

  async searchEnglish(session, query, english, type, page, previousFingerprints = []) {
    const output = await super.searchEnglish(session, query, english, type, page, previousFingerprints);
    const state = this.sessions.get(sessionKey(session));
    if (state?.kind === 'search') state.remote = true;
    return output;
  }

  async list(session, rawQuery = '', typeInput = 'item', options = {}, page = 1) {
    const type = catalogType(typeInput);
    const query = String(rawQuery || '').trim() ? queryText(rawQuery) : '';
    const filters = normalizeFilters(options);
    if (!this.catalog.has(type)) return this.missingCatalog(type);
    const resolution = query && !filters.object ? this.dict.resolve(query, { limit: 10 }) : { queries: [] };
    return this.localSearch(session, query, type, [query, ...resolution.queries], filters, page, true);
  }

  localSearch(session, query, type, queries, filters, page = 1, listOnly = false) {
    const result = this.catalog.search(type, queries, filters, page, this.config.pageSize);
    if (page > result.totalPages) return `本次检索只有 ${result.totalPages} 页。`;
    this.setState(session, { kind: 'local', type, query, queries, filters, page, total: result.total, totalPages: result.totalPages, items: result.items, listOnly });
    if (result.exactUnique && !listOnly && page === 1) return this.localDetail(type, result.items[0]);
    return views.searchReply(type, query, result, this.dict, { source: this.catalog.source.name, synthetic: this.catalog.source.synthetic, filters, prefix: this.config.command });
  }

  localDetail(type, entity) {
    const s = this.catalog.source;
    return views.detailReply(type, entity.id, entity, this.dict, { source: s.name, sourceUrl: s.url, version: s.version, synthetic: s.synthetic, prefix: this.config.command });
  }

  async detail(typeInput, rawId, options = {}) {
    const type = catalogType(typeInput), id = normalizeId(rawId);
    const local = !options.remote && (this.dataSource !== 'api' || LOCAL_ONLY.has(type)) ? this.catalog.get(type, id) : null;
    if (local) return this.localDetail(type, local);
    if (LOCAL_ONLY.has(type) || this.dataSource === 'local') return this.catalog.has(type) ? `当前本地资料包没有 ${views.LABELS[type]} ID ${id}。` : this.missingCatalog(type);
    normalizeType(type);
    const result = await this.api.detail(type, id);
    const entity = unwrapDetail(result.body, type);
    const actualId = entityId(entity);
    if (actualId && actualId !== id) return '接口返回的 ID 与请求不一致，已停止显示。请管理员检查 API 契约。';
    return views.detailReply(type, id, entity, this.dict, { fetchedAt: result.fetchedAt, cacheHit: result.cacheHit, sourceUrl: format.sourceUrl(type, id), prefix: this.config.command });
  }

  async pick(session, rawIndex) {
    const state = this.sessions.get(sessionKey(session));
    if (state?.kind === 'search' && state.remote) {
      if (state.expiresAt < Date.now()) return '搜索结果已过期，请重新查询。';
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 1 || index > state.items.length) return `请选择 1 到 ${state.items.length} 之间的序号。`;
      return this.detail(state.type, entityId(state.items[index - 1]), { remote: true });
    }
    if (state?.kind !== 'local') return super.pick(session, rawIndex);
    if (state.expiresAt < Date.now()) return '搜索结果已过期，请重新查询。';
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 1 || index > state.items.length) return `请选择 1 到 ${state.items.length} 之间的序号。`;
    return this.localDetail(state.type, state.items[index - 1]);
  }

  async next(session) {
    const state = this.sessions.get(sessionKey(session));
    if (state?.kind !== 'local') return super.next(session);
    if (state.expiresAt < Date.now()) return '搜索结果已过期，请重新查询。';
    if (state.page >= state.totalPages) return '已经是最后一页。';
    return this.localSearch(session, state.query, state.type, state.queries, state.filters, state.page + 1, state.listOnly);
  }

  async navigate(session, destination) {
    const state = this.sessions.get(sessionKey(session));
    if (!state || state.expiresAt < Date.now()) return '没有当前搜索结果，或结果已过期。请先查询。';
    let totalPages;
    if (state.kind === 'local') totalPages = state.totalPages;
    else if (state.kind === 'dictionary') totalPages = Math.max(1, Math.ceil(state.total / this.config.pageSize));
    else if (state.kind !== 'search') return '请先用 pick 选择一个英文名称。';
    if (destination === 'last' && !totalPages) return '远程接口未确认总页数，无法直接跳到末页。请使用 next 继续。';
    const page = destination === 'first' ? 1 : destination === 'last' ? totalPages : state.page - 1;
    if (page < 1 || page === state.page) return destination === 'last' ? '已经是最后一页。' : '已经是第一页。';
    if (state.kind === 'local') return this.localSearch(session, state.query, state.type, state.queries, state.filters, page, state.listOnly);
    if (state.kind === 'dictionary') return this.dictionary(session, state.query, page, state.note, state.fullText);
    return this.searchEnglish(session, state.query, state.english, state.type, page, []);
  }

  statcaps(schoolInput, levelInput) {
    const school = schoolName(schoolInput);
    const level = Number(levelInput);
    if (!school || !Number.isInteger(level) || level < 1 || level > 1000) return '请输入有效学派和 1–1000 的整数等级，例如 wiz.statcaps fire 170。';
    if (!this.catalog.has('statcaps')) return this.missingCatalog('statcaps');
    const result = this.catalog.search('statcaps', [], { school, level }, 1, 10);
    if (!result.items.length) {
      const levels = this.catalog.levels(school);
      return `本地资料包没有 ${school} ${level} 级的上限记录。${levels.length ? `可查等级：${levels.join('、')}。` : '该学派尚无记录。'}不自动取整等级或推算未收录数值。`;
    }
    if (result.total > 1) return '此学派与等级在资料包中有多条上限记录，请管理员明确版本后重新导入。';
    return this.localDetail('statcaps', result.items[0]);
  }

  calculate(base, options = {}) {
    const input = damageInput(base, options);
    const result = calculateDamage(input);
    const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
    const rows = [{ label: '普通伤害估算', value: String(result.normal), icon: 'stat.damage' }, { label: '指定暴击倍率后', value: String(result.critical), icon: 'stat.critical' }, ...result.stages.map(row => ({ label: row.label, value: number.format(row.value) }))];
    const reply = views.replyFromModel({ kind: 'calc', title: '单段伤害估算', subtitle: `基础 ${input.base} · 面板加成 ${input.damagePercent || 0}% · 手动暴击倍率 ${input.criticalMultiplier || 1}`, sections: [{ title: '计算过程', rows }, { title: '模型假设', rows: result.assumptions.map((v, i) => ({ label: String(i + 1), value: v })) }], footer: '简化估算模型；不代表当前游戏服务器的逐步结算。' });
    reply.report = formatDamageReport(result);
    return reply;
  }

  async mobCalculate(rawId, base, options = {}) {
    const id = normalizeId(rawId);
    const school = schoolName(options.school || '');
    if (!school) return '请指定攻击学派，例如 wiz.mobcalc 123 1000 -s fire -d 100。';
    let entity = this.dataSource !== 'api' ? this.catalog.get('mob', id) : null;
    let source = '本地资料包';
    if (!entity && this.dataSource !== 'local') {
      const response = await this.api.detail('mob', id);
      entity = unwrapDetail(response.body, 'mob');
      if (entityId(entity) && entityId(entity) !== id) return '接口返回的怪物 ID 不匹配，已停止计算。';
      source = 'Wizard404';
    }
    if (!entity) return '当前本地资料包没有该怪物。';
    if (entity.stats_scope === 'base_only') return `当前资料只包含怪物本体属性，未汇总装备，不能用作完整目标抗性。请使用 ${this.config.command}.calc 手动指定确认后的 -r 抗性。`;
    const stats = entity.stats || {};
    // Only explicitly named percentages are accepted; generic resist/rating values are ambiguous.
    const resist = stats.resist_percent?.[school] ?? stats[school]?.resist_percent ?? entity.resist_percent?.[school]
      ?? (typeof stats.resist_percent === 'number' ? stats.resist_percent : undefined)
      ?? (typeof entity.resist_percent === 'number' ? entity.resist_percent : undefined);
    if (!Number.isFinite(resist)) return `此怪物没有明确标注单位的 ${school} resist_percent 字段，未把评级或不完整装备属性当百分比。请使用 ${this.config.command}.calc 并手动指定 -r 抗性。`;
    const reply = this.calculate(base, { ...options, resist });
    for (const page of reply.pages) {
      const note = `目标：${entity.name || id}〔${id}〕 · ${school} 抗性 ${resist}% · 来源 ${source}`;
      page.text = `${note}\n${page.text}`;
      page.card.subtitle = note;
      page.card.footer += ' 只读取明确给出的抗性；不会汇总缺失的怪物装备或推算暴击评级。';
    }
    return reply;
  }

  async relation(rawId, relationType) {
    const id = normalizeId(rawId);
    if (!['drops', 'cheats', 'deck'].includes(relationType)) throw new ApiError('invalid-relation', '仅支持怪物掉落、机制和牌组查询。');
    const entity = this.dataSource !== 'api' ? this.catalog.get('mob', id) : null;
    if (entity && relationType === 'deck' && Array.isArray(entity.deck)) {
      const rows = entity.deck.map((card, i) => ({ label: `${i + 1}`, value: `${card.name || card.object_name || '未命名卡牌'} × ${card.count ?? '未提供张数'}${card.id ? ` [${card.id}]` : ''}` }));
      if (!rows.length) rows.push({ label: '牌组', value: '本地资料未收录卡牌，不代表怪物没有法术。' });
      return views.replyFromModel({ kind: 'mob', title: `${entity.name} · 牌组`, subtitle: `ID ${id}`, school: entity.school, sections: [{ title: '', rows }], footer: `来源：${this.catalog.source.name} · ${this.catalog.source.version || '版本未标注'}` });
    }
    if (this.dataSource === 'local') return `当前本地资料包没有可显示的${{ drops: '掉落', cheats: '完整机制说明', deck: '牌组' }[relationType]}。这些资料可通过配置 Wizard404 API 查询；has_cheats 标记不等于完整攻略。`;
    const result = await this.api.relation(id, relationType);
    const body = result.body;
    if (body?.success === false) throw new ApiError('response-error', '来源返回错误，暂时无法显示。');
    const data = body && Object.hasOwn(body, 'data') ? body.data : body;
    if (!data || (typeof data !== 'object' && !(relationType === 'cheats' && typeof data === 'string'))) return '接口返回结构不符合预期，未将其当作百科数据。';
    return views.relationReply(id, relationType, data, this.dict, { fetchedAt: result.fetchedAt, cacheHit: result.cacheHit, school: entity?.school });
  }

  async lookup(rawPath) {
    const objectName = queryText(rawPath);
    if (this.dataSource !== 'api' && this.catalog.has('zone')) {
      const entries = this.catalog.lookupObject('zone', objectName);
      if (entries.length === 1) return this.localDetail('zone', entries[0]);
      if (!entries.length) return '本地资料中没有完全匹配的区域内部路径。where 区分大小写，不会用相似路径代替。';
      return `该内部路径对应 ${entries.length} 个本地区域，请使用 ${this.config.command}.detail zone ID 明确选择：${entries.slice(0, 10).map(e => `${e.name} [${e.id}]`).join('；')}`;
    }
    if (this.dataSource === 'local') return this.missingCatalog('zone');
    const result = await this.api.lookupZone(objectName);
    const entity = unwrapDetail(result.body, 'zone');
    const id = entityId(entity);
    if (!id) return '区域查询响应中没有有效 ID，请管理员检查响应结构。';
    return views.detailReply('zone', id, entity, this.dict, { fetchedAt: result.fetchedAt, cacheHit: result.cacheHit, sourceUrl: format.sourceUrl('zone', id), prefix: this.config.command });
  }

  async compare(left, right) {
    const leftId = normalizeId(left), rightId = normalizeId(right);
    const a = this.dataSource !== 'api' ? this.catalog.get('item', leftId) : null;
    const b = this.dataSource !== 'api' ? this.catalog.get('item', rightId) : null;
    if (a && b) {
      const s = this.catalog.source;
      return views.compareReply(leftId, a, rightId, b, this.dict, { source: s.name, version: s.version, sourceUrl: s.url, synthetic: s.synthetic });
    }
    if (this.dataSource === 'local') return '当前本地资料包没有同时收录这两个物品 ID。';
    // A comparison uses one source for both records, avoiding a silent local/API version mix.
    const leftResult = await this.api.detail('item', leftId);
    const rightResult = await this.api.detail('item', rightId);
    const leftEntity = unwrapDetail(leftResult.body, 'item'), rightEntity = unwrapDetail(rightResult.body, 'item');
    if ((entityId(leftEntity) && entityId(leftEntity) !== leftId) || (entityId(rightEntity) && entityId(rightEntity) !== rightId)) return '接口返回了不匹配的物品 ID，已停止对比。';
    return views.compareReply(leftId, leftEntity, rightId, rightEntity, this.dict, { sourceUrl: `${format.sourceUrl('item', leftId)}\n${format.sourceUrl('item', rightId)}`, fetchedAt: Math.min(leftResult.fetchedAt, rightResult.fetchedAt), cacheHit: leftResult.cacheHit && rightResult.cacheHit });
  }

  prepareReply(session, output) {
    for (const [key, state] of this.responses) if (state.expiresAt < Date.now()) this.responses.delete(key);
    while (this.responses.size >= 512) this.responses.delete(this.responses.keys().next().value);
    const inputPages = output?.kind === 'wizard101.reply' ? output.pages : views.splitText(output);
    const platform = getPlatform(session);
    const pages = [];
    for (const page of inputPages) {
      if (textCost(neutralizeMentions(page.text, platform), platform) <= 1500) { pages.push(page); continue; }
      let chunk = '';
      const chunks = [];
      for (const c of String(page.text)) {
        if (chunk && textCost(neutralizeMentions(chunk + c, platform), platform) > 1400) { chunks.push(chunk); chunk = ''; }
        chunk += c;
      }
      if (chunk) chunks.push(chunk);
      for (const part of chunks) {
        const subpages = page.card ? views.textReply(part, { title: page.card.title, kind: page.card.kind, school: page.card.school }).pages : [{ text: part, summary: part.split('\n')[0] }];
        pages.push(...subpages);
      }
    }
    if (pages.length > 60) { pages.length = 60; pages[59] = { text: pages[59].text + '\n内容超过 60 页传输上限，更多请查原始资料源。' }; }
    this.responses.set(sessionKey(session), { pages, expiresAt: Date.now() + 10 * 60 * 1000 });
    return this.responsePage(session, 1);
  }

  responsePage(session, rawPage) {
    const state = this.responses.get(sessionKey(session));
    if (!state || state.expiresAt < Date.now()) return { text: '没有当前详情，或详情已过期。请先查询。' };
    const page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1 || page > state.pages.length) return { text: `当前回复只有 ${state.pages.length} 页。` };
    const value = state.pages[page - 1];
    const hint = state.pages.length > 1 ? `第 ${page}/${state.pages.length} 页 · ${this.config.command}.page ${page < state.pages.length ? page + 1 : 1}` : '';
    return { ...value, text: `${value.text}${hint ? `\n${hint}` : ''}`, summary: `${value.summary || value.text.split('\n')[0]}${hint ? `\n${hint}` : ''}`, card: value.card ? { ...value.card, footer: `${value.card.footer || ''}${hint ? `\n${hint}` : ''}` } : undefined, nextPage: page < state.pages.length ? page + 1 : null };
  }

  status() { const s = this.catalog.stats(); return super.status() + `\n本地游戏资料：${s.entries} 条\n资料类别：${Object.entries(s.types).map(([k, v]) => `${k} ${v}`).join('、') || '未导入'}\n资料来源策略：${this.dataSource}\n回复模式：${this.config.replyMode || 'auto'}`; }
  dispose() { this.responses.clear(); this.catalog.dispose(); super.dispose(); }
}

module.exports = { BotController, buffList, damageInput };
