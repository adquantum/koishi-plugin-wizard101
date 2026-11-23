'use strict';

const { randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { h } = require('koishi');
const { neutralizeMentions, getPlatform } = require('./platform.cjs');

const TTL_MS = 180000;
const COMPONENT_PREFIX = 'w101p:';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ALLOWED_MENTIONS = Object.freeze({ parse: [] });
const SEARCH_BY = [['名称', 'Name'], ['内部名称', 'Object'], ['条目 ID', 'ID']];
const BASIC_SCHOOLS = [['全部', 'Any'], ['火焰', 'Fire'], ['冰霜', 'Ice'], ['风暴', 'Storm'], ['神圣', 'Myth'], ['生命', 'Life'], ['亡灵', 'Death'], ['平衡', 'Balance']];
const MOB_SCHOOLS = [...BASIC_SCHOOLS, ['星辰', 'Star'], ['太阳', 'Sun'], ['月亮', 'Moon'], ['暗影', 'Shadow']];
const SPELL_SCHOOLS = [...BASIC_SCHOOLS, ['星辰', 'Star'], ['太阳', 'Sun'], ['月亮', 'Moon'], ['园艺', 'Gardening'], ['暗影', 'Shadow'], ['钓鱼', 'Fishing'], ['场外魔咒', 'Cantrips'], ['城堡魔法', 'Castlemagic'], ['旋风棋', 'WhirlyBurly']];
const ITEM_KINDS = [['全部', 'Any'], ['帽子', 'Hat'], ['长袍', 'Robe'], ['靴子', 'Shoes'], ['法杖', 'Weapon'], ['短剑', 'Athame'], ['护符', 'Amulet'], ['戒指', 'Ring'], ['牌组', 'Deck'], ['宝石', 'Jewel'], ['坐骑', 'Mount']];
const MOB_KINDS = [['全部', 'Any'], ['简单', 'Easy'], ['普通', 'Normal'], ['精英', 'Elite'], ['首领', 'Boss']];
const SPELL_KINDS = [['全部', 'Any'], ['治疗', 'Healing'], ['伤害', 'Damage'], ['挂饰', 'Charm'], ['护盾', 'Ward'], ['光环', 'Aura'], ['全局', 'Global'], ['群体', 'AOE'], ['偷取', 'Steal'], ['操控', 'Manipulation'], ['附魔', 'Enchantment'], ['变身', 'Polymorph'], ['诅咒', 'Curse'], ['厄运', 'Jinx'], ['变异', 'Mutate'], ['隐蔽', 'Cloak']];
const LOCAL_NAMES = {
  item: ['物品', '物品'], spell: ['法术', '法術'], mob: ['怪物', '怪物'], pet: ['宠物', '寵物'], fish: ['鱼类', '魚類'], statcaps: ['属性上限', '屬性上限'], calc: ['计算', '計算'], help: ['帮助', '幫助'],
  find: ['查询', '查詢'], list: ['列表', '列表'], deck: ['牌组', '牌組'], name: ['名称', '名稱'], school: ['学派', '學派'], kind: ['种类', '種類'], level: ['等级', '等級'], rank: ['等级或豆数', '等級或豆數'], search_by: ['查询方式', '查詢方式'], show_spell_effects: ['显示法术效果', '顯示法術效果'], num_targets: ['目标数量', '目標數量'], wow: ['稀有系数', '稀有係數'], exclusive: ['专属宠物', '專屬寵物'], is_sentinel: ['哨兵鱼', '哨兵魚'], use_object_name: ['显示内部名称', '顯示內部名稱'], base: ['基础伤害', '基礎傷害'], damage: ['伤害加成', '傷害加成'], pierce: ['穿透', '穿透'], critical: ['暴击评级', '暴擊評級'], resist: ['抗性', '抗性'], block: ['格挡评级', '格擋評級'], buffs: ['增益列表', '增益列表'], pvp: ['竞技场模式', '競技場模式'],
};

function localNames(name) {
  const pair = LOCAL_NAMES[name];
  return pair ? { 'zh-CN': pair[0], 'zh-TW': pair[1] } : undefined;
}

function option(name, type, description, { required = false, choices, defaultValue } = {}) {
  return { name, type, description, name_localizations: localNames(name), required,
    ...(choices ? { choices: choices.map(([label, value]) => ({ name: label, value })) } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

const nameOption = () => option('name', 3, '中文名、英文名、内部名称或完整 ID；列表可使用 *', { required: true });
const schoolOption = (choices = BASIC_SCHOOLS, required = false) => option('school', 3, required ? '选择本次查询或攻击的学派' : '按学派筛选；默认全部', { choices, required, ...(required ? {} : { defaultValue: 'Any' }) });
const searchOption = () => option('search_by', 3, '按名称、内部名称或 ID 查询；ID 以文字传递以保留精度', { choices: SEARCH_BY, defaultValue: 'Name' });
const intOption = (name, description, required = false, defaultValue) => option(name, 4, description, { required, defaultValue });
const boolOption = (name, description, defaultValue) => option(name, 5, description, { defaultValue });
const calcOptions = () => [
  intOption('base', '法术基础伤害', true), intOption('damage', '按上游接口输入伤害百分比；不会自动应用 PvE 曲线', true), intOption('pierce', '穿透百分比', true), intOption('critical', '暴击评级', true),
];
const calcOptional = () => [option('buffs', 3, '空格分隔的增益；例：35 35 40 20P -50P；P 为穿透', { defaultValue: '' }), boolOption('pvp', '是否使用 PvP 规则；默认是', true)];

function searchOptions(type, method) {
  const schools = type === 'spell' ? SPELL_SCHOOLS : type === 'mob' ? MOB_SCHOOLS : BASIC_SCHOOLS;
  const options = [nameOption(), schoolOption(schools)];
  if (['item', 'spell', 'mob'].includes(type)) options.push(option('kind', 3, '按种类筛选；默认全部', { choices: type === 'item' ? ITEM_KINDS : type === 'spell' ? SPELL_KINDS : MOB_KINDS, defaultValue: 'Any' }));
  if (type === 'item') options.push(intOption('level', '需求等级；-1 表示不限', false, -1));
  if (['spell', 'mob', 'fish'].includes(type)) options.push(intOption('rank', type === 'spell' ? '法术豆数；-1 表示不限' : '等级；-1 表示不限', false, -1));
  if (type === 'pet') options.push(intOption('wow', 'Wow Factor；-1 表示不限', false, -1), boolOption('exclusive', '是否为专属宠物；留空表示不限'));
  if (type === 'fish') options.push(boolOption('is_sentinel', '是否为哨兵鱼；留空表示不限'));
  if (method !== 'list') options.push(searchOption());
  if (type === 'spell' && method === 'find') options.push(boolOption('show_spell_effects', '显示解析后的完整法术效果', false), intOption('num_targets', '法术目标数量；默认 1', false, 1));
  if (type === 'fish' && method === 'list') options.push(boolOption('use_object_name', '在列表中显示内部名称', false));
  return options;
}

function routeDefinitions() {
  const routes = {};
  for (const type of ['item', 'spell', 'mob', 'pet', 'fish']) {
    const noun = LOCAL_NAMES[type][0];
    for (const method of ['find', 'list']) routes[`${type}.${method}`] = { description: method === 'find' ? `查询${noun}详细资料` : `列出匹配的${noun}名称`, options: searchOptions(type, method) };
  }
  routes['mob.deck'] = { description: '查询怪物牌组和携带法术', options: searchOptions('mob', 'deck') };
  routes['mob.calc'] = { description: '估算针对指定怪物的伤害', options: [nameOption(), schoolOption(MOB_SCHOOLS.slice(1), true), ...calcOptions(), ...calcOptional(), searchOption()] };
  routes['statcaps.find'] = { description: '按等级与学派查询属性上限', options: [intOption('level', '角色等级', true), schoolOption(BASIC_SCHOOLS.slice(1), true)] };
  routes.calc = { description: '计算伤害、抗性、穿透和暴击的影响', options: [...calcOptions(), intOption('resist', '目标抗性百分比', true), intOption('block', '目标格挡评级', true), ...calcOptional()] };
  routes.help = { description: '查看 Wizard101 中文百科命令帮助', options: [] };
  return routes;
}

function normalizeCommandName(value = '') {
  if (value !== '' && (typeof value !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value))) throw new Error('Discord 命令命名空间须为空或 1–32 位小写英文字母、数字、下划线或连字符。');
  return value;
}

function cleanOption(entry) {
  const { defaultValue, ...result } = entry;
  if (result.type === 3 && !result.choices) result.max_length = result.name === 'buffs' ? 1024 : 256;
  return result;
}

/** No registration is performed here. Default: the upstream eight root commands. */
function buildDiscordCommands({ commandName = '' } = {}) {
  commandName = normalizeCommandName(commandName);
  const routes = routeDefinitions();
  const groups = ['item', 'spell', 'mob', 'pet', 'fish', 'statcaps'].map(name => ({
    name, type: commandName ? 2 : 1, name_localizations: localNames(name), description: `Wizard101 ${LOCAL_NAMES[name][0]}百科`,
    options: Object.entries(routes).filter(([route]) => route.startsWith(`${name}.`)).map(([route, definition]) => ({
      name: route.split('.')[1], type: 1, name_localizations: localNames(route.split('.')[1]), description: definition.description, options: definition.options.map(cleanOption),
    })),
  }));
  const direct = ['calc', 'help'].map(name => ({ name, type: 1, name_localizations: localNames(name), description: routes[name].description, options: routes[name].options.map(cleanOption) }));
  if (commandName) return [{ name: commandName, type: 1, ...(commandName === 'wiz' ? { name_localizations: { 'zh-CN': '巫师百科', 'zh-TW': '巫師百科' } } : {}), description: 'Wizard101 中文百科：物品、法术、怪物、宠物、鱼类与计算', options: [...groups, ...direct] }];
  return [...groups, ...direct];
}

function parseDiscordCommand(data, { commandName = '' } = {}) {
  commandName = normalizeCommandName(commandName);
  let root = data;
  if (commandName) {
    if (root?.name !== commandName || !Array.isArray(root.options) || root.options.length !== 1) throw new Error('无效的命令结构。');
    root = root.options[0];
  }
  let route = root?.name;
  let provided = root?.options || [];
  if (!['calc', 'help'].includes(route)) {
    if (!Array.isArray(provided) || provided.length !== 1 || provided[0]?.type !== 1) throw new Error('无效的子命令。');
    route += `.${provided[0].name}`;
    provided = provided[0].options || [];
  }
  const definition = routeDefinitions()[route];
  if (!definition || !Array.isArray(provided)) throw new Error('未识别的百科命令。');
  const values = new Map();
  for (const value of provided) {
    if (!value || values.has(value.name)) throw new Error('参数重复或缺失。');
    values.set(value.name, value);
  }
  const params = {};
  for (const entry of definition.options) {
    const input = values.get(entry.name);
    values.delete(entry.name);
    if (!input) {
      if (entry.required) throw new Error('缺少必填参数。');
      if (Object.hasOwn(entry, 'defaultValue')) params[entry.name] = entry.defaultValue;
      continue;
    }
    const value = input.value;
    if (input.type !== entry.type || (entry.type === 3 && (typeof value !== 'string' || value.length > (entry.name === 'buffs' ? 1024 : 256)))
      || (entry.type === 4 && !Number.isSafeInteger(value)) || (entry.type === 5 && typeof value !== 'boolean')
      || (entry.choices && !entry.choices.some(choice => choice.value === value))) throw new Error('命令参数类型或选项不正确。');
    params[entry.name] = value;
  }
  if (values.size) throw new Error('命令包含未知参数，请同步最新命令。');
  return { route, params };
}

function defaultRedact(value) {
  return String(value ?? '').replace(/w404_[A-Za-z0-9_-]{6,}/g, '[已隐藏密钥]').replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [已隐藏]');
}

function discordText(value) {
  return neutralizeMentions(value, 'discord').replace(/[\\*_`~|()\[\]<>#]/g, '\\$&');
}

function splitText(value, budget = 1600) {
  const result = [];
  let current = '', used = 0;
  for (const character of neutralizeMentions(value || '暂无可显示的资料。', 'discord')) {
    const cost = discordText(character).length;
    if (current && used + cost > budget) { result.push(current); current = ''; used = 0; }
    current += character; used += cost;
  }
  if (current || !result.length) result.push(current);
  return result;
}

function snowflake(value) { return typeof value === 'string' && /^\d{1,30}$/.test(value); }
function componentRows(state, disabled = false) {
  const atFirst = state.index === 0 && state.part === 0;
  const atLast = state.index === state.pageCount - 1 && state.part === state.parts.length - 1;
  return [{ type: 1, components: [['first', '首页'], ['prev', '上一页'], ['next', '下一页'], ['last', '末页']].map(([action, label], index) => ({
    type: 2, style: 2, custom_id: `${COMPONENT_PREFIX}${state.id}:${action}`, label, disabled: disabled || (index < 2 ? atFirst : atLast),
  })) }];
}

/** The QQ 4.14.0 group/C2C encoder supports input buttons; QQGuild does not. */
function buildQQInputButtons(session, { enabled = false, prefix = 'wiz' } = {}) {
  if (!enabled || getPlatform(session) !== 'qq') return [];
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(prefix)) throw new Error('QQ 按钮指令前缀无效。');
  return [h('button-group', {}, [['first', '首页'], ['prev', '上一页'], ['next', '下一页'], ['last', '末页']].map(([action, label]) => h('button', { type: 'input', id: `w101-${action}`, text: `${prefix}.${action}` }, h.text(label))))];
}

class NativeInteractions {
  constructor({ execute, renderPage, redact = defaultRedact, commandName = '', registryPath, ttlMs = TTL_MS, maxSessions = 128, maxImageBytes = 2097152, logger, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    if (typeof execute !== 'function') throw new Error('原生交互需要 execute 回调。');
    this.execute = execute;
    this.renderPage = renderPage || (page => ({ content: page.text }));
    this.redact = value => defaultRedact(redact(defaultRedact(value)));
    this.commandName = normalizeCommandName(commandName);
    this.registryPath = registryPath ? path.resolve(registryPath) : null;
    this.ttlMs = Number.isSafeInteger(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, TTL_MS) : TTL_MS;
    this.maxSessions = Number.isSafeInteger(maxSessions) && maxSessions > 0 ? Math.min(maxSessions, 512) : 128;
    this.maxImageBytes = Number.isSafeInteger(maxImageBytes) && maxImageBytes > 0 ? Math.min(maxImageBytes, 8388608) : 2097152;
    this.logger = logger; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.sessions = new Map(); this.registry = new Map(); this.disposers = []; this.syncQueue = Promise.resolve(); this.disposed = false;
  }

  warn(message) { try { this.logger?.warn?.(message); } catch (_) { /* Logs never receive raw errors, interaction tokens, or response bodies. */ } }

  sanitize(value, depth = 0, visited = new WeakMap()) {
    if (typeof value === 'string') return this.redact(value);
    if (!value || typeof value !== 'object' || Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
    if (depth > 20) return '[字段嵌套过深]';
    if (visited.has(value)) return '[重复引用]';
    const result = Array.isArray(value) ? [] : {};
    visited.set(value, result);
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      result[key] = /^(?:token|api_?key|authorization|cookie|password|secret)$/i.test(key) ? '[已隐藏]' : this.sanitize(child, depth + 1, visited);
    }
    return result;
  }

  async loadRegistry() {
    if (!this.registryReady) this.registryReady = (async () => {
      if (!this.registryPath) return;
      let data;
      try {
        const stat = await fs.stat(this.registryPath);
        if (stat.size > 1048576) throw new Error();
        data = JSON.parse(await fs.readFile(this.registryPath, 'utf8'));
      } catch (error) { if (error?.code === 'ENOENT') return; throw new Error('原生命令归属记录无法读取；为避免覆盖其他插件命令，已停止同步。'); }
      if (data?.kind !== 'wizard101.native-commands' || data.schemaVersion !== 1 || !Array.isArray(data.commands)) throw new Error('原生命令归属记录格式不正确，已停止同步。');
      for (const entry of data.commands) {
        if (!snowflake(entry.applicationId) || !snowflake(entry.commandId) || (entry.guildId && !snowflake(entry.guildId)) || !/^[a-z][a-z0-9_-]{0,31}$/.test(entry.name)) throw new Error('原生命令归属记录包含无效条目，已停止同步。');
        this.registry.set(this.registryKey(entry.applicationId, entry.guildId, entry.name), entry);
      }
    })();
    return this.registryReady;
  }

  registryKey(applicationId, guildId, name) { return JSON.stringify([applicationId, guildId || '', name]); }

  async saveRegistry() {
    if (!this.registryPath) return;
    const temporary = `${this.registryPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.registryPath), { recursive: true });
      await fs.writeFile(temporary, JSON.stringify({ kind: 'wizard101.native-commands', schemaVersion: 1, commands: [...this.registry.values()] }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, this.registryPath);
    } catch (_) {
      await fs.unlink(temporary).catch(() => {});
      throw new Error('Discord 命令已更新，但本地归属记录未能保存。请修复数据目录写入权限后在本次进程内再次同步。');
    }
  }

  assertDiscord(bot) {
    if (bot?.platform !== 'discord' || !snowflake(bot.selfId) || typeof bot.http !== 'function') throw new Error('请选择已连接的 Discord 官方适配器机器人。');
    if (bot.config?.slash !== false) throw new Error('请先将 adapter-discord 的 slash 设为 false，防止其批量覆盖原生命令。');
  }

  /** Explicit administrator action only. Never calls a bulk overwrite or delete endpoint. */
  syncDiscord(bot, { guildId = '' } = {}) {
    const task = this.syncQueue.then(() => this._syncDiscord(bot, { guildId }));
    this.syncQueue = task.catch(() => {});
    return task;
  }

  async _syncDiscord(bot, { guildId }) {
    this.assertDiscord(bot);
    if (this.disposed) throw new Error('原生交互服务已停止。');
    if (guildId && !snowflake(guildId)) throw new Error('Discord 服务器 ID 须为完整数字字符串。');
    await this.loadRegistry();
    const applicationId = bot.selfId;
    const desired = buildDiscordCommands({ commandName: this.commandName });
    let existing;
    try { existing = guildId ? await bot.internal.getGuildApplicationCommands(applicationId, guildId) : await bot.internal.getGlobalApplicationCommands(applicationId); }
    catch (_) { throw new Error('读取 Discord 命令失败，请检查机器人连接和应用权限。'); }
    if (!Array.isArray(existing) || existing.some(value => !snowflake(value?.id) || typeof value.name !== 'string' || (value.type !== undefined && ![1, 2, 3, 4].includes(value.type)))) throw new Error('Discord 命令列表格式不正确。');
    const plan = desired.map(command => {
      const owned = this.registry.get(this.registryKey(applicationId, guildId, command.name));
      const sameName = existing.find(value => (value.type ?? 1) === 1 && value.name === command.name);
      if (sameName && sameName.id !== owned?.commandId) throw new Error(`/${command.name} 已被其他命令使用，已停止同步且未修改任何命令。可改用命名空间 wiz。`);
      return { command, current: owned && existing.find(value => value.id === owned.commandId && (value.type ?? 1) === 1) };
    });
    const result = { count: desired.length, created: [], updated: [], scope: guildId ? 'guild' : 'global', guildId, commands: [] };
    for (const { command, current } of plan) {
      let registered;
      try {
        if (current) registered = guildId ? await bot.internal.editGuildApplicationCommand(applicationId, guildId, current.id, command) : await bot.internal.editGlobalApplicationCommand(applicationId, current.id, command);
        else registered = guildId ? await bot.internal.createGuildApplicationCommand(applicationId, guildId, command) : await bot.internal.createGlobalApplicationCommand(applicationId, command);
      } catch (_) { throw new Error('同步 Discord 命令失败；已完成的归属记录已保留，可由管理员再次同步。'); }
      if (!snowflake(registered?.id)) throw new Error('Discord 未返回有效的命令 ID，已停止后续同步。');
      const entry = { applicationId, guildId, name: command.name, commandId: registered.id };
      this.registry.set(this.registryKey(applicationId, guildId, command.name), entry);
      await this.saveRegistry();
      result[current ? 'updated' : 'created'].push(command.name);
      result.commands.push({ name: command.name, id: registered.id });
    }
    return result;
  }

  attach(ctx) {
    if (this.attached || this.disposed) throw new Error('原生交互服务不能重复挂载。');
    this.attached = true;
    this.disposers.push(ctx.on('discord/interaction-create', (data, bot) => this.handleDiscordCommand(data, bot).catch(() => this.warn('Discord 原生命令处理失败。'))));
    this.disposers.push(ctx.on('interaction/button', session => this.handleDiscordButton(session).catch(() => this.warn('Discord 翻页交互处理失败。'))));
    this.disposers.push(ctx.on('dispose', () => this.dispose()));
    return this;
  }

  async request(bot, method, url, data) {
    // Use the adapter's authenticated HTTP client directly. Internal.define()
    // logs webhook URLs (containing interaction tokens) at debug level.
    return (await bot.http(method, url, { data })).data;
  }

  async ephemeral(bot, data, content) {
    if (!snowflake(data?.application_id) || data.application_id !== bot?.selfId || typeof data?.token !== 'string') return;
    try { await this.request(bot, 'POST', `/webhooks/${data.application_id}/${encodeURIComponent(data.token)}`, { content: discordText(content), flags: 64, allowed_mentions: ALLOWED_MENTIONS }); }
    catch (_) { this.warn('Discord 交互提示未能发送。'); }
  }

  createSession(bot, data) {
    const sourceUser = data.member?.user || data.user;
    const session = bot.session({
      type: 'interaction/command', timestamp: this.now(), user: { id: sourceUser.id, name: sourceUser.global_name || sourceUser.username || '' },
      channel: { id: data.channel_id || data.channel?.id }, ...(data.guild_id ? { guild: { id: data.guild_id } } : {}), message: { id: data.id, content: '' },
    });
    session.isDirect = !data.guild_id;
    session.setInternal('discord', { t: 'INTERACTION_CREATE', d: data });
    return session;
  }

  provider(reply) {
    if (reply?.kind !== 'wizard101.reply') return { pageCount: 1, getPage: () => ({ text: typeof reply === 'string' ? reply : '暂无可显示的资料。' }) };
    if (Array.isArray(reply.pages) && reply.pages.length) return { pageCount: reply.pages.length, getPage: index => reply.pages[index] };
    if (Number.isSafeInteger(reply.pageCount) && reply.pageCount > 0 && typeof reply.getPage === 'function') return { pageCount: reply.pageCount, getPage: index => reply.getPage(index) };
    return { pageCount: 1, getPage: () => ({ text: '暂无可显示的资料。' }) };
  }

  async loadPage(state, index) {
    if (state.cache.has(index)) return state.cache.get(index);
    const raw = await state.getPage(index);
    const page = this.sanitize(typeof raw === 'string' ? { text: raw } : raw || { text: '暂无可显示的资料。' });
    const chunks = splitText(page.text);
    const parts = chunks.map((text, i) => ({ ...page, text, ...(i ? { card: undefined, png: undefined, summary: text } : {}) }));
    state.cache.set(index, parts);
    while (state.cache.size > 3) state.cache.delete(state.cache.keys().next().value);
    return parts;
  }

  async payload(state, index, part, parts) {
    const page = parts[part];
    let rendered;
    try { rendered = await this.renderPage(page, state.session); }
    catch (_) { this.warn('原生图卡渲染失败，已回退为文字。'); rendered = { content: page.text }; }
    let content = discordText(this.redact(rendered?.content ?? page.text));
    if (content.length > 1800) content = discordText(page.text);
    const png = rendered?.png;
    const validImage = (Buffer.isBuffer(png) || png instanceof Uint8Array) && png.length >= 8 && png.length <= this.maxImageBytes && Buffer.from(png.subarray(0, 8)).equals(PNG_SIGNATURE);
    const suffix = `\n第 ${index + 1}/${state.pageCount} 页${parts.length > 1 ? ` · 文字分段 ${part + 1}/${parts.length}` : ''} · 按钮 ${Math.ceil(this.ttlMs / 1000)} 秒内有效。`;
    const view = { ...state, index, part, parts };
    const body = { content: content + suffix, allowed_mentions: ALLOWED_MENTIONS, components: componentRows(view), embeds: [], attachments: [] };
    if (!validImage) return { body, content };
    body.attachments = [{ id: '0', filename: 'wizard101.png', description: 'Wizard101 中文资料卡' }];
    const form = new FormData();
    form.append('files[0]', new Blob([png], { type: 'image/png' }), 'wizard101.png');
    form.append('payload_json', JSON.stringify(body));
    const fallbackContent = `图卡发送失败，以下为文字资料。\n${discordText(page.text)}`;
    return { body: form, content, fallbackContent, fallback: { ...body, content: fallbackContent + suffix, attachments: [] } };
  }

  async edit(state, rendered) {
    const url = `/webhooks/${state.applicationId}/${encodeURIComponent(state.token)}/messages/@original`;
    try { return await this.request(state.bot, 'PATCH', url, rendered.body); }
    catch (_) {
      if (rendered.fallback) {
        this.warn('原生图卡发送失败，尝试一次文字回退。');
        rendered.content = rendered.fallbackContent;
        try { return await this.request(state.bot, 'PATCH', url, rendered.fallback); } catch (_) { /* Exactly one text fallback. */ }
      }
      const error = new Error('原生回复发送失败。');
      error.nativeDeliveryFailed = true;
      throw error;
    }
  }

  async handleDiscordCommand(data, bot) {
    if (this.disposed || bot?.platform !== 'discord' || data?.type !== 2 || bot.config?.slash !== false) return false;
    if (!snowflake(data.id) || !snowflake(data.application_id) || data.application_id !== bot.selfId || typeof data.token !== 'string') return false;
    const names = buildDiscordCommands({ commandName: this.commandName }).map(command => command.name);
    if (!names.includes(data.data?.name)) return false;
    await this.loadRegistry();
    if (data.data.guild_id && data.data.guild_id !== data.guild_id) return false;
    const scopes = data.data.guild_id ? [data.data.guild_id] : ['', ...(data.guild_id ? [data.guild_id] : [])];
    if (!scopes.some(scope => this.registry.get(this.registryKey(bot.selfId, scope, data.data.name))?.commandId === data.data.id)) return false;
    const userId = (data.member?.user || data.user)?.id, channelId = data.channel_id || data.channel?.id;
    if (!snowflake(userId) || !snowflake(channelId)) return false;
    // Ack before querying data, rendering, or enumerating any lazy page.
    await this.request(bot, 'POST', `/interactions/${data.id}/${encodeURIComponent(data.token)}/callback`, { type: 5 });
    let state;
    try {
      const { route, params } = parseDiscordCommand(data.data, { commandName: this.commandName });
      const session = this.createSession(bot, data);
      const reply = await this.execute(session, route, params);
      if (this.disposed) throw new Error('原生交互服务已停止。');
      const source = this.provider(reply);
      state = { ...source, id: randomBytes(12).toString('hex'), bot, applicationId: data.application_id, token: data.token, session, userId, channelId, guildId: data.guild_id || '', messageId: '', cache: new Map(), index: 0, part: 0, parts: [], expired: false, content: '' };
      state.parts = await this.loadPage(state, 0);
      const rendered = await this.payload(state, 0, 0, state.parts);
      if (this.disposed) throw new Error('原生交互服务已停止。');
      const message = await this.edit(state, rendered);
      if (!snowflake(message?.id)) throw new Error('Discord 未返回原消息 ID。');
      state.messageId = message.id; state.content = rendered.content; state.expiresAt = this.now() + this.ttlMs;
      if (this.disposed) { await this.expire(state); return true; }
      while (this.sessions.size >= this.maxSessions) await this.expire(this.sessions.values().next().value);
      this.sessions.set(state.id, state);
      state.timer = this.setTimer(() => this.expire(state).catch(() => {}), this.ttlMs);
      state.timer?.unref?.();
    } catch (error) {
      this.warn('Discord 百科查询或回复未完成。');
      if (error?.nativeDeliveryFailed) return true;
      try { await this.request(bot, 'PATCH', `/webhooks/${data.application_id}/${encodeURIComponent(data.token)}/messages/@original`, { content: '查询未完成，请检查参数或稍后重新查询。输入帮助命令查看用法。', allowed_mentions: ALLOWED_MENTIONS, components: [], attachments: [], embeds: [] }); }
      catch (_) { this.warn('Discord 查询错误提示未能发送。'); }
    }
    return true;
  }

  async handleDiscordButton(session) {
    const data = session?.discord?.d;
    const id = session?.event?.button?.id || data?.data?.custom_id;
    if (this.disposed || getPlatform(session) !== 'discord' || data?.type !== 3 || typeof id !== 'string' || !id.startsWith(COMPONENT_PREFIX)) return false;
    const matched = /^w101p:([a-f0-9]{24}):(first|prev|next|last)$/.exec(id);
    const state = matched && this.sessions.get(matched[1]);
    const bot = session.bot;
    if (!state || state.expired || this.now() >= state.expiresAt) {
      if (state) await this.expire(state);
      await this.ephemeral(bot, data, '分页已过期，请重新发起查询。');
      return true;
    }
    if (state.applicationId !== bot?.selfId || state.applicationId !== data.application_id || state.userId !== session.userId || state.channelId !== session.channelId || state.guildId !== (session.guildId || '') || state.messageId !== data.message?.id) {
      await this.ephemeral(bot, data, '只有在原频道发起查询的用户可以操作这条消息。');
      return true;
    }
    if (state.busy) { await this.ephemeral(bot, data, '正在翻页，请稍候再试。'); return true; }
    state.busy = true;
    state.pending = (async () => {
      const action = matched[2];
      let index = state.index, part = state.part, parts = state.parts;
      if (action === 'first') { index = 0; part = 0; }
      else if (action === 'last') { index = state.pageCount - 1; part = -1; }
      else if (action === 'next') { if (part + 1 < parts.length) part++; else if (index + 1 < state.pageCount) { index++; part = 0; } }
      else if (part > 0) part--; else if (index > 0) { index--; part = -1; }
      parts = await this.loadPage(state, index);
      if (part === -1) part = parts.length - 1;
      if (index === state.index && part === state.part) return;
      const rendered = await this.payload(state, index, part, parts);
      if (state.expired || this.now() >= state.expiresAt) { await this.ephemeral(bot, data, '分页已过期，请重新发起查询。'); return; }
      await this.edit(state, rendered);
      state.index = index; state.part = part; state.parts = parts; state.content = rendered.content;
    })();
    try { await state.pending; }
    catch (_) { this.warn('Discord 翻页失败，原消息保持可重试。'); await this.ephemeral(bot, data, '本次翻页未完成，请稍后重试或重新查询。'); }
    finally { state.busy = false; state.pending = null; }
    return true;
  }

  async expire(state) {
    if (state.expiry) return state.expiry;
    state.expired = true; this.sessions.delete(state.id); this.clearTimer(state.timer);
    state.expiry = (async () => {
      if (state.pending) await state.pending.catch(() => {});
      try { await this.request(state.bot, 'PATCH', `/webhooks/${state.applicationId}/${encodeURIComponent(state.token)}/messages/@original`, { content: `${state.content}\n分页已过期，请重新查询。`, components: componentRows(state, true), allowed_mentions: ALLOWED_MENTIONS }); }
      catch (_) { this.warn('未能禁用已过期的 Discord 按钮；再次点击时会提示过期。'); }
      finally { state.token = ''; state.cache.clear(); }
    })();
    return state.expiry;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) { try { dispose?.(); } catch (_) {} }
    await Promise.allSettled([...this.sessions.values()].map(state => this.expire(state)));
  }
}

function createNativeInteractions(options) { return new NativeInteractions(options); }

module.exports = { NativeInteractions, createNativeInteractions, buildDiscordCommands, parseDiscordCommand, buildQQInputButtons, discordText, TTL_MS };
