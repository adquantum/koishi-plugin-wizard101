'use strict';

const path = require('node:path');
const { Schema, h } = require('koishi');
const { Wizard404Client, ApiError } = require('./api.cjs');
const { LocaleDictionary } = require('./locale.cjs');
const { KimerithController } = require('./kimerith-controller.cjs');
const { LocalCatalog } = require('./catalog.cjs');
const { CardRenderer } = require('./cards.cjs');
const { sendReply, getPlatform } = require('./platform.cjs');
const views = require('./views.cjs');
const { createNativeInteractions, buildQQInputButtons } = require('./interactions.cjs');

const name = 'wizard101';
const usage = 'Wizard101 中文图鉴与中英词典。支持 QQ 官方 Bot 与 Discord 的 PNG 资料卡、装备/法术/怪物/宠物/鱼类本地检索及伤害估算。中文词典、原版图标和游戏资料由部署者导入；在线接口需要服务端 Key 与 User-Agent，在线按名搜索默认关闭。';
const defaults = {
  command: 'wiz', defaultType: 'item', enableChineseAliases: true,
  localePath: '', apiKey: '', authMode: 'bearer', baseUrl: 'https://wizard404.com/api/v1', userAgent: '',
  onlineSearchEnabled: false, searchParam: 'q', pageParam: 'page', pageSizeParam: 'limit', pageSize: 8,
  minIntervalMs: 1200, cooldownMs: 1500, timeoutMs: 10000, cacheTtlMs: 900000, maxCacheEntries: 128, maxCacheBytes: 16777216,
  maxResponseBytes: 4194304, maxQueue: 12, aliases: {},
  catalogPath: '', dataSource: 'hybrid', replyMode: 'auto', iconPath: '', fontPath: '', portraitPath: '',
  nativeDiscordEnabled: false, discordCommandName: '', discordGuildId: '', qqInputButtons: false,
};

const Config = Schema.intersect([
  Schema.object({
    command: Schema.string().default(defaults.command).description('主指令前缀，仅小写英文字母、数字和连字符。'),
    defaultType: Schema.union(['item', 'spell', 'mob', 'zone', 'npc', 'quest', 'talent', 'event']).default('item').description('未指定类别时使用的查询类型。'),
    enableChineseAliases: Schema.boolean().default(true).description('启用“巫师百科”和“巫师词典”别名。'),
    localePath: Schema.string().default('').description('自有词典 JSON/JSON.gz 路径。留空读取 Koishi 工作目录 data/wizard101/locale-zh.json.gz；公开包不附游戏词典。'),
    aliases: Schema.dict(Schema.union([Schema.string(), Schema.array(Schema.string())])).default({}).description('社区俗称 → 英文全名。多个候选用数组，玩家需选择。'),
  }).description('中文与指令'),
  Schema.object({
    catalogPath: Schema.string().default('').description('本地游戏资料 JSON/JSON.gz；留空读取 data/wizard101/catalog.json.gz。可用 tools/catalog/from-sqlite.py 导入自有 wizdb 数据库。'),
    dataSource: Schema.union(['hybrid', 'local', 'api']).default('hybrid').description('hybrid 优先本地已收录类别，缺类别时使用 API；local 只查本地；api 优先 API。宠物、鱼类、属性上限始终需要本地资料。'),
    replyMode: Schema.union(['auto', 'text', 'image']).default('auto').description('auto 在 QQ/Discord 发送图示资料卡，其他平台使用文字；image 强制尝试图片；text 只发文字。失败时回退文字。'),
    iconPath: Schema.string().default('').description('图标 manifest.json 路径；留空读取 data/wizard101/icons/manifest.json。原版 DDS/TGA 可用 Python 图标导入工具转换。'),
    fontPath: Schema.string().default('').description('中文字体 TTF/OTF/TTC 路径；留空自动找 Noto CJK、微软雅黑等。无有效中文字库时回退文字。'),
    portraitPath: Schema.string().default('').description('可选 PNG_Images 目录，展示原版法术和怪物缩略图；留空读取 data/wizard101/portraits。只读取本地 PNG。'),
  }).description('本地图鉴与跨平台图片'),
  Schema.object({
    nativeDiscordEnabled: Schema.boolean().default(false).description('启用 Discord 原生斜线命令和四按钮分页。必须将官方 Discord 适配器 slash 设为 false，再由管理员执行 wiz.sync。'),
    discordCommandName: Schema.string().default('').description('留空使用 /item、/spell、/mob、/pet、/fish、/statcaps、/calc、/help；填 wiz 则使用 /wiz 下的命令组。不会覆盖其他插件同名命令。'),
    discordGuildId: Schema.string().default('').description('可选测试服务器 ID；留空同步全局命令。'),
    qqInputButtons: Schema.boolean().default(false).description('QQ 群/单聊显示指令输入按钮，需已具备平台按钮与 Markdown 权限；不具备时保持关闭。QQ 频道继续使用文字分页。'),
  }).description('Kimerith 原生交互'),
  Schema.object({
    apiKey: Schema.string().role('secret').default('').description('Wizard404 只读 API Key；也可设置服务端环境变量 W404_API_KEY。'),
    authMode: Schema.union(['bearer', 'x-api-key']).default('bearer').description('鉴权请求头类型。'),
    userAgent: Schema.string().default('').description('必填后才能联网，例如 SubataWiki/0.3.0 (你的真实联系邮箱或项目地址)。也可设置 W404_USER_AGENT。'),
    baseUrl: Schema.string().default(defaults.baseUrl).description('可信 API 服务的根地址。仅发送到此服务；修改前确认其归属。默认 Wizard404 官方 API。'),
  }).description('服务端连接'),
  Schema.object({
    onlineSearchEnabled: Schema.boolean().default(false).description('仅控制 API 按名搜索，需部署端核实名称参数和响应结构后开启。进入 API 名称流程且关闭时返回词典结果或提示；不影响本地检索和按 ID 查询，来源由 dataSource 决定。'),
    searchParam: Schema.string().default('q').description('待核实的名称参数，q 只是可修改的适配默认值。'),
    pageParam: Schema.string().default('page').description('待核实的页码参数。'),
    pageSizeParam: Schema.string().default('limit').description('待核实的每页条数参数；留空不发送。'),
    pageSize: Schema.number().min(1).max(10).step(1).default(8).description('每页显示条数。'),
  }).description('在线搜索适配'),
  Schema.object({
    minIntervalMs: Schema.number().min(0).max(60000).step(1).default(1200).description('所有上游请求串行间隔，建议保持至少 1200ms；0 仅供本地测试。'),
    cooldownMs: Schema.number().min(0).max(60000).step(1).default(1500).description('同一会话指令冷却。'),
    timeoutMs: Schema.number().min(100).max(60000).step(1).default(10000).description('单次请求超时。'),
    cacheTtlMs: Schema.number().min(0).max(86400000).step(1).default(900000).description('响应缓存时间，默认 15 分钟。'),
    maxCacheEntries: Schema.number().min(1).max(512).step(1).default(128).description('内存缓存条目上限。'),
    maxCacheBytes: Schema.number().min(1024).max(134217728).step(1).default(16777216).description('缓存响应的原始文本字节预算，默认 16 MiB。JavaScript 对象内存会高于文本大小。'),
    maxResponseBytes: Schema.number().min(1024).max(16777216).step(1).default(4194304).description('单次响应大小上限，默认 4 MiB。'),
    maxQueue: Schema.number().min(1).max(32).step(1).default(12).description('待处理上游请求数上限。'),
  }).description('额度与资源'),
]);

function redact(text, key) {
  let value = String(text ?? '');
  if (key) value = value.split(key).join('[已隐藏密钥]');
  return value.replace(/w404_dev_[A-Za-z0-9_-]+/g, '[已隐藏密钥]');
}

function apply(ctx, inputConfig) {
  const config = { ...defaults, ...inputConfig };
  config.apiKey = String(config.apiKey || process.env.W404_API_KEY || '').trim();
  config.userAgent = String(config.userAgent || process.env.W404_USER_AGENT || '').trim();
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(config.command)) throw new Error('Wizard101 指令前缀无效。');
  const logger = ctx.logger(name);
  let initialization;
  let controller;
  let renderer;
  let disposed = false;
  let localeFailed = false;

  function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      const filePath = path.resolve(ctx.baseDir || process.cwd(), config.localePath || 'data/wizard101/locale-zh.json.gz');
      let dict;
      try { dict = await LocaleDictionary.load(filePath, { aliases: config.aliases }); }
      catch (_) {
        localeFailed = true;
        logger.warn('尚未加载有效中文词典。请导入自有 WAD/LANG 并设置 localePath；英文和 ID 查询仍可使用。');
        dict = new LocaleDictionary({ schemaVersion: 1, source: {}, stats: {}, files: [], entries: [] }, { aliases: config.aliases });
      }
      if (disposed) { dict.dispose(); return null; }
      let api;
      try { api = new Wizard404Client(config); }
      catch (error) { dict.dispose(); throw error; }
      let catalog;
      try { catalog = await LocalCatalog.load(path.resolve(ctx.baseDir || process.cwd(), config.catalogPath || 'data/wizard101/catalog.json.gz')); }
      catch (_) {
        catalog = new LocalCatalog();
        logger.info('尚未加载本地游戏资料包；Kimerith 完整查询需导入后使用，Wiki API 扩展可独立配置。');
      }
      if (disposed) { dict.dispose(); api.dispose(); catalog.dispose(); return null; }
      renderer = new CardRenderer({
        iconPath: path.resolve(ctx.baseDir || process.cwd(), config.iconPath || 'data/wizard101/icons/manifest.json'),
        fontPath: config.fontPath ? path.resolve(ctx.baseDir || process.cwd(), config.fontPath) : '',
        portraitPath: path.resolve(ctx.baseDir || process.cwd(), config.portraitPath || 'data/wizard101/portraits'),
        maxRows: 28, maxImageBytes: 2097152,
      });
      controller = new KimerithController(config, dict, api, catalog);
      return controller;
    })();
    return initialization;
  }

  function redactObject(value) {
    if (typeof value === 'string') return redact(value, config.apiKey);
    if (Array.isArray(value)) return value.map(redactObject);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactObject(v)]));
    return value;
  }

  const native = createNativeInteractions({
    commandName: config.discordCommandName,
    registryPath: path.resolve(ctx.baseDir || process.cwd(), 'data/wizard101/native-commands.json'),
    logger, redact: value => redact(value, config.apiKey),
    execute: async (session, route, params) => {
      const service = await initialize();
      if (!service || disposed) return views.textReply('插件已停用。');
      try { return await service.run(session, () => service.execute(session, route, params)); }
      catch (error) {
        if (error.code === 'invalid-calculation' || /^(请输入|查询)/.test(String(error.message))) return views.textReply(redact(error.message, config.apiKey), { title: '参数需要调整' });
        throw error;
      }
    },
    renderPage: async (page, session) => {
      const safe = redactObject(page);
      const imageAllowed = config.replyMode !== 'text' && ['discord', 'qq', 'qqguild'].includes(getPlatform(session));
      if (imageAllowed && safe.card && renderer) {
        try { return { content: safe.summary || safe.text.split('\n')[0], png: await renderer.render(safe.card) }; }
        catch (_) { /* The native manager retains the full page for text fallback. */ }
      }
      return { content: safe.text };
    },
  });
  if (config.nativeDiscordEnabled) native.attach(ctx);

  let cardWarning = false;
  async function deliver(service, session, output, existingPage = false) {
    const reply = redactObject(existingPage ? output : service.prepareReply(session, output));
    const platform = getPlatform(session);
    const imageAllowed = config.replyMode === 'image' || (config.replyMode === 'auto' && ['qq', 'qqguild', 'discord'].includes(platform));
    if (imageAllowed && reply.card) {
      try { reply.png = await renderer.render(reply.card); }
      catch (_) {
        if (!cardWarning) { logger.warn('资料卡未能生成，已使用文字。请检查中文字体、图标清单及图片依赖。'); cardWarning = true; }
      }
    }
    if (disposed) return;
    const buttons = buildQQInputButtons(session, { enabled: config.qqInputButtons, prefix: `${config.command}.page` });
    await sendReply(session, reply, { mode: config.replyMode, logger, buttons, maxImageBytes: 2097152, pageCommand: `${config.command}.page`, nextPage: reply.nextPage || 1 });
  }

  function action(work, rateLimit = true, existingPage = false) {
    return async ({ session, options = {} }, ...args) => {
      let sending = false;
      try {
        const service = await initialize();
        if (!service || disposed) return h.text('插件已停用。');
        const output = rateLimit ? await service.run(session, () => work(service, session, options, ...args)) : await work(service, session, options, ...args);
        sending = true;
        await deliver(service, session, output, existingPage && output && typeof output === 'object');
        return;
      } catch (error) {
        // sendReply already attempted its single fallback. Do not send a third message.
        if (sending) return;
        const code = error instanceof ApiError ? error.code : 'local-error';
        logger.warn('查询失败，类型=%s，HTTP=%s', code, Number.isInteger(error.status) ? error.status : 'n/a');
        let text;
        if (error instanceof ApiError) {
          text = error.message;
          if (error.retryAfterMs > 0) text += ` 请在 ${Math.ceil(error.retryAfterMs / 1000)} 秒后重试。`;
        }
        else if (error.code === 'invalid-calculation' || /^(请输入|查询|条目 ID|ID 必须)/.test(String(error.message))) text = error.message;
        else text = '查询暂时失败，请稍后重试。若持续发生，请管理员检查插件配置和接口响应格式。';
        return h.text(redact(text, config.apiKey));
      }
    };
  }

  const p = config.command;
  function filters(command) {
    return command.option('school', '-s <school:string> 本地学派筛选')
      .option('kind', '-k <kind:string> 本地类型/部位筛选')
      .option('level', '-l <level:number> 本地精确等级筛选')
      .option('rank', '-r <rank:number> 本地阶级/豆数筛选')
      .option('wow', '--wow <wow:number> 宠物 Wow Factor')
      .option('exclusive', '--exclusive <exclusive:string> 专属 true/false')
      .option('sentinel', '--sentinel <sentinel:string> 哨兵鱼 true/false')
      .option('object', '--object 按内部 Object 名检索')
      .option('remote', '--remote 绕过本地资料查询 API');
  }
  const command = ctx.command(`${p} [query:text]`, 'Wizard101 中文百科')
    .option('type', '-t <type:string> 类别，例如 spell、mob、item')
    .option('page', '-p <page:posint> 页码')
    .usage('选项必须放在名称前。离线词典无需 API Key；在线按名搜索需管理员先完成接口联调。')
    .action(action((service, session, options, query) => query ? service.search(session, query, options.type || config.defaultType, options.page || 1, options) : service.help()));
  if (config.enableChineseAliases) command.alias('巫师百科').alias('巫师');

  filters(ctx.command(`${p}.search <query:text>`, '指定类别搜索百科'))
    .option('type', '-t <type:string> 类别')
    .option('page', '-p <page:posint> 页码')
    .action(action((service, session, options, query) => service.search(session, query, options.type || config.defaultType, options.page || 1, options)));
  const dictCommand = ctx.command(`${p}.dict <query:text>`, '离线中英名称、文本互查')
    .option('full', '-f 扫描长对话文本（较慢）')
    .action(action((service, session, options, query) => service.dictionary(session, query, 1, localeFailed ? '尚未导入有效中文词典，请管理员导入自有 WAD/LANG 并设置 localePath。' : '', Boolean(options.full))));
  if (config.enableChineseAliases) dictCommand.alias('巫师词典');
  for (const [type, title] of Object.entries({ ...require('./format.cjs').LABELS, pet: '宠物', fish: '鱼类', gear: '装备' })) {
    filters(ctx.command(`${p}.${type} <query:text>`, `${title}查询`))
      .action(action((service, session, options, query) => service.search(session, query, type, 1, options)));
  }
  filters(ctx.command(`${p}.list [query:text]`, '筛选本地游戏资料列表'))
    .option('type', '-t <type:string> 类别，如 item/pet/fish')
    .option('page', '-p <page:posint> 页码')
    .action(action((service, session, options, query) => service.list(session, query, options.type || config.defaultType, options, options.page || 1)));
  ctx.command(`${p}.statcaps <school:string> <level:posint>`, '查询本地等级属性上限')
    .action(action((service, session, options, school, level) => service.statcaps(school, level)));
  ctx.command(`${p}.detail <type:string> <id:string>`, '按类别和 ID 查询详情')
    .action(action((service, session, _, type, id) => service.detail(type, id)));
  ctx.command(`${p}.pick <index:posint>`, '选择当前列表的序号')
    .action(action((service, session, _, index) => service.pick(session, index)));
  ctx.command(`${p}.next`, '当前查询的下一页')
    .action(action((service, session) => service.next(session)));
  for (const [direction, title] of [['prev', '上一页'], ['first', '第一页'], ['last', '最后一页']]) {
    ctx.command(`${p}.${direction}`, `当前查询的${title}`)
      .action(action((service, session) => service.navigate(session, direction)));
  }
  ctx.command(`${p}.page <page:posint>`, '当前长回复/图卡的指定页')
    .action(action((service, session, options, page) => service.responsePage(session, page), true, true));
  for (const direction of ['first', 'prev', 'next', 'last']) {
    ctx.command(`${p}.page.${direction}`, '当前资料卡翻页')
      .action(action((service, session) => service.responseNavigate(session, direction), true, true));
  }
  for (const relation of ['drops', 'cheats', 'deck']) {
    const labels = { drops: '怪物掉落', cheats: '怪物特殊机制', deck: '怪物牌库' };
    ctx.command(`${p}.${relation} <id:string>`, labels[relation])
      .action(action((service, session, _, id) => service.relation(id, relation)));
  }
  ctx.command(`${p}.where <objectName:text>`, '以游戏内部路径精确查区域')
    .action(action((service, session, _, objectName) => service.lookup(objectName)));
  ctx.command(`${p}.compare <left:string> <right:string>`, '对比两个物品 ID 的同字段数值')
    .action(action((service, session, _, left, right) => service.compare(left, right)));
  function calculatorOptions(command) {
    return command.option('damage', '-d <damage:number> 已曲线面板伤害百分比')
      .option('blades', '-b <blades:string> 刃百分比，逗号分隔')
      .option('traps', '-t <traps:string> 陷阱百分比，逗号分隔')
      .option('shields', '--shields <shields:string> 盾减伤百分比，逗号分隔')
      .option('weaknesses', '-w <weaknesses:string> 虚弱减伤百分比，逗号分隔')
      .option('resist', '-r <resist:number> 目标抗性百分比')
      .option('pierce', '-p <pierce:number> 穿透百分比')
      .option('critical', '-c <critical:number> 手动暴击倍率，1–10')
      .option('flatDamage', '--flat-damage <flatDamage:number> 固定增伤')
      .option('flatResist', '--flat-resist <flatResist:number> 固定减伤');
  }
  calculatorOptions(ctx.command(`${p}.estimate <base:number>`, 'v0.2 简化单段伤害估算'))
    .action(action((service, session, options, base) => service.calculate(base, options)));
  calculatorOptions(ctx.command(`${p}.mobcalc <id:string> <base:number>`, '按怪物明确百分比抗性估算单段伤害'))
    .option('school', '-s <school:string> 攻击学派')
    .action(action((service, session, options, id, base) => service.mobCalculate(id, base, options)));

  const nouns = { item: '装备', spell: '法术', mob: '怪物', pet: '宠物', fish: '鱼类' };
  if (config.enableChineseAliases) {
    for (const [type, noun] of Object.entries(nouns)) ctx.command(`${p}.${type}`).alias(`${p}.${noun}`);
  }
  function referenceFilters(command, type, list = false) {
    command.option('school', '-s <school:string> 学派，Any 表示全部');
    if (['item', 'spell', 'mob'].includes(type)) command.option('kind', '-k <kind:string> 装备部位、法术种类或怪物等级类别');
    if (type === 'item') command.option('level', '-l <level:integer> 精确需求等级，-1 不限');
    if (['spell', 'mob', 'fish'].includes(type)) command.option('rank', '-r <rank:integer> 阶级或豆数，-1 不限');
    if (type === 'pet') command.option('wow', '--wow <wow:integer> Wow Factor').option('exclusive', '--exclusive <exclusive:string> 是否专属 true/false');
    if (type === 'fish') command.option('sentinel', '--sentinel <sentinel:string> 哨兵鱼 true/false');
    if (!list) command.option('searchBy', '--search-by <mode:string> Name / Object / ID');
    if (type === 'spell' && !list) command.option('effects', '--effects <effects:string> 是否显示完整效果树 true/false').option('targets', '--targets <targets:integer> 目标数量');
    if (type === 'fish' && list) command.option('objectNames', '--object-names <objectNames:string> 用内部名称筛选 true/false');
    return command;
  }
  function referenceParams(options, name) {
    return { ...options, name, search_by: options.searchBy, show_spell_effects: options.effects, num_targets: options.targets, is_sentinel: options.sentinel, use_object_name: options.objectNames };
  }
  for (const [type, noun] of Object.entries(nouns)) for (const method of ['find', 'list']) {
    const command = referenceFilters(ctx.command(`${p}.${type}.${method} ${method === 'list' ? '[name:text]' : '<name:text>'}`, `${noun}${method === 'list' ? '名称列表' : '完整资料'}`), type, method === 'list');
    if (config.enableChineseAliases) command.alias(`${p}.${type}.${method === 'list' ? '列表' : '查询'}`);
    command.action(action((service, session, options, name) => service.execute(session, `${type}.${method}`, referenceParams(options, name))));
  }
  referenceFilters(ctx.command(`${p}.mob.deck <name:text>`, '查询怪物及其装备牌组'), 'mob')
    .action(action((service, session, options, name) => service.execute(session, 'mob.deck', referenceParams(options, name))));
  ctx.command(`${p}.statcaps.find <level:integer> <school:string>`, 'Kimerith 十级档位属性上限')
    .action(action((service, session, options, level, school) => service.execute(session, 'statcaps.find', { level, school })));
  function referenceCalc(command, target = false) {
    command.option('damage', '-d <damage:integer> 输入已确认的伤害加成百分比')
      .option('pierce', '-p <pierce:integer> 穿透百分比')
      .option('critical', '-c <critical:integer> 暴击评级')
      .option('buffs', '--buffs <buffs:string> 按顺序空格分隔，如 "35 40 -50 20P"')
      .option('pvp', '--pvp <pvp:string> true 为 PvP，false 为 PvE，默认 true');
    if (target) command.option('school', '-s <school:string> 攻击学派').option('base', '--base <base:integer> 基础伤害').option('searchBy', '--search-by <mode:string> Name / Object / ID');
    else command.option('resist', '-r <resist:integer> 抗性百分比').option('block', '--block <block:integer> 格挡评级');
    return command;
  }
  referenceCalc(ctx.command(`${p}.calc <base:integer>`, 'Kimerith 兼容伤害计算，使用暴击和格挡评级'))
    .action(action((service, session, options, base) => service.execute(session, 'calc', { ...options, base })));
  referenceCalc(ctx.command(`${p}.mob.calc <name:text>`, '按怪物本体与装备汇总属性计算伤害'), true)
    .action(action((service, session, options, name) => service.execute(session, 'mob.calc', referenceParams(options, name))));
  ctx.command(`${p}.help`, '查看中文版完整命令帮助')
    .action(action((service, session) => service.execute(session, 'help')));
  if (config.enableChineseAliases) {
    ctx.command(`${p}.item`).alias(`${p}.物品`);
    ctx.command(`${p}.mob.deck`).alias(`${p}.mob.牌组`);
    ctx.command(`${p}.mob.calc`).alias(`${p}.mob.计算`);
    ctx.command(`${p}.statcaps`).alias(`${p}.属性上限`);
    ctx.command(`${p}.statcaps.find`).alias(`${p}.statcaps.查询`);
    ctx.command(`${p}.calc`).alias(`${p}.计算`);
    ctx.command(`${p}.help`).alias(`${p}.帮助`);
  }
  ctx.command(`${p}.sync`, '同步本插件的 Discord 原生命令', { authority: 4 })
    .option('bot', '--bot <bot:string> Discord 机器人账号 ID')
    .option('guild', '--guild <guild:string> 指定测试服务器 ID')
    .action(async ({ session, options }) => {
      // Koishi skips authority validation when no database-backed user is
      // attached. Never let that implicitly authorize remote registration.
      if (!(Number(session?.user?.authority) >= 4)) return '同步命令需要已验证的 Koishi 管理员权限（authority ≥ 4）。请先配置用户数据库与管理员账号。';
      if (!config.nativeDiscordEnabled) return '请管理员先启用 nativeDiscordEnabled，并将 Discord 适配器的 slash 设为 false。';
      const bots = ctx.bots.filter(bot => bot.platform === 'discord' && (!options.bot || bot.selfId === options.bot));
      const bot = session.bot?.platform === 'discord' && !options.bot ? session.bot : bots.length === 1 ? bots[0] : null;
      if (!bot) return '请用 --bot 指定已连接的 Discord 机器人账号 ID。';
      try { const result = await native.syncDiscord(bot, { guildId: options.guild || config.discordGuildId || '' }); return `Discord 原生命令同步完成。${result?.count ? `共 ${result.count} 个根命令。` : ''}`; }
      catch (error) { return redact(error.message || '命令同步失败，请检查配置与应用权限。', config.apiKey); }
    });
  ctx.command(`${p}.status`, '查看公开的插件状态', { authority: 3 })
    .action(action(service => service.status(), false));

  ctx.on('ready', async () => {
    try { await initialize(); }
    catch (_) { logger.warn('插件初始化失败，请检查 API 地址和配置。'); }
  });
  ctx.on('dispose', () => {
    disposed = true;
    controller?.dispose();
    renderer?.dispose();
    native.dispose();
    // Initialization may still be reading a large local dictionary; it observes disposed before constructing a client.
  });
}

module.exports = { name, usage, Config, apply, defaults, redact };
