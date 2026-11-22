'use strict';

const path = require('node:path');
const { Schema, h } = require('koishi');
const { Wizard404Client, ApiError } = require('./api.cjs');
const { LocaleDictionary } = require('./locale.cjs');
const { WikiController } = require('./controller.cjs');

const name = 'wizard101';
const usage = 'Wizard101 中文百科与中英词典。公开版需要导入自有汉化数据；配置服务端 API Key 和含联系方式的 User-Agent 后可使用在线接口。在线按名搜索默认关闭，需先验证参数。';
const defaults = {
  command: 'wiz', defaultType: 'item', enableChineseAliases: true,
  localePath: '', apiKey: '', authMode: 'bearer', baseUrl: 'https://wizard404.com/api/v1', userAgent: '',
  onlineSearchEnabled: false, searchParam: 'q', pageParam: 'page', pageSizeParam: 'limit', pageSize: 8,
  minIntervalMs: 1200, cooldownMs: 1500, timeoutMs: 10000, cacheTtlMs: 900000, maxCacheEntries: 128, maxCacheBytes: 16777216,
  maxResponseBytes: 4194304, maxQueue: 12, aliases: {},
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
    apiKey: Schema.string().role('secret').default('').description('Wizard404 只读 API Key；也可设置服务端环境变量 W404_API_KEY。'),
    authMode: Schema.union(['bearer', 'x-api-key']).default('bearer').description('鉴权请求头类型。'),
    userAgent: Schema.string().default('').description('必填后才能联网，例如 SubataWiki/0.1.1 (你的真实联系邮箱或项目地址)。也可设置 W404_USER_AGENT。'),
    baseUrl: Schema.string().default(defaults.baseUrl).description('可信 API 服务的根地址。仅发送到此服务；修改前确认其归属。默认 Wizard404 官方 API。'),
  }).description('服务端连接'),
  Schema.object({
    onlineSearchEnabled: Schema.boolean().default(false).description('实验功能：部署端核实名称参数和响应结构后开启。关闭时按名返回离线词典，ID 查询仍可用。'),
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
      controller = new WikiController(config, dict, api);
      return controller;
    })();
    return initialization;
  }

  function action(work, rateLimit = true) {
    return async ({ session, options = {} }, ...args) => {
      try {
        const service = await initialize();
        if (!service || disposed) return h.text('插件已停用。');
        const text = rateLimit ? await service.run(session, () => work(service, session, options, ...args)) : await work(service, session, options, ...args);
        return h.text(redact(text, config.apiKey));
      } catch (error) {
        const code = error instanceof ApiError ? error.code : 'local-error';
        logger.warn('查询失败，类型=%s，HTTP=%s', code, Number.isInteger(error.status) ? error.status : 'n/a');
        let text;
        if (error instanceof ApiError) {
          text = error.message;
          if (error.retryAfterMs > 0) text += ` 请在 ${Math.ceil(error.retryAfterMs / 1000)} 秒后重试。`;
        }
        else if (/^(请输入|查询过长|查询不能|条目 ID|ID 必须)/.test(String(error.message))) text = error.message;
        else text = '查询暂时失败，请稍后重试。若持续发生，请管理员检查插件配置和接口响应格式。';
        return h.text(redact(text, config.apiKey));
      }
    };
  }

  const p = config.command;
  const command = ctx.command(`${p} [query:text]`, 'Wizard101 中文百科')
    .option('type', '-t <type:string> 类别，例如 spell、mob、item')
    .option('page', '-p <page:posint> 页码')
    .usage('选项必须放在名称前。离线词典无需 API Key；在线按名搜索需管理员先完成接口联调。')
    .action(action((service, session, options, query) => query ? service.search(session, query, options.type || config.defaultType, options.page || 1) : service.help()));
  if (config.enableChineseAliases) command.alias('巫师百科');

  ctx.command(`${p}.search <query:text>`, '指定类别搜索百科')
    .option('type', '-t <type:string> 类别')
    .option('page', '-p <page:posint> 页码')
    .action(action((service, session, options, query) => service.search(session, query, options.type || config.defaultType, options.page || 1)));
  const dictCommand = ctx.command(`${p}.dict <query:text>`, '离线中英名称、文本互查')
    .option('full', '-f 扫描长对话文本（较慢）')
    .action(action((service, session, options, query) => service.dictionary(session, query, 1, localeFailed ? '尚未导入有效中文词典，请管理员导入自有 WAD/LANG 并设置 localePath。' : '', Boolean(options.full))));
  if (config.enableChineseAliases) dictCommand.alias('巫师词典');
  for (const [type, title] of Object.entries(require('./format.cjs').LABELS)) {
    ctx.command(`${p}.${type} <query:text>`, `${title}查询`)
      .action(action((service, session, _, query) => service.search(session, query, type)));
  }
  ctx.command(`${p}.detail <type:string> <id:string>`, '按类别和 ID 查询详情')
    .action(action((service, session, _, type, id) => service.detail(type, id)));
  ctx.command(`${p}.pick <index:posint>`, '选择当前列表的序号')
    .action(action((service, session, _, index) => service.pick(session, index)));
  ctx.command(`${p}.next`, '当前查询的下一页')
    .action(action((service, session) => service.next(session)));
  for (const relation of ['drops', 'cheats', 'deck']) {
    const labels = { drops: '怪物掉落', cheats: '怪物特殊机制', deck: '怪物牌库' };
    ctx.command(`${p}.${relation} <id:string>`, labels[relation])
      .action(action((service, session, _, id) => service.relation(id, relation)));
  }
  ctx.command(`${p}.where <objectName:text>`, '以游戏内部路径精确查区域')
    .action(action((service, session, _, objectName) => service.lookup(objectName)));
  ctx.command(`${p}.compare <left:string> <right:string>`, '对比两个物品 ID 的同字段数值')
    .action(action((service, session, _, left, right) => service.compare(left, right)));
  ctx.command(`${p}.status`, '查看公开的插件状态', { authority: 3 })
    .action(action(service => service.status(), false));

  ctx.on('ready', async () => {
    try { await initialize(); }
    catch (_) { logger.warn('插件初始化失败，请检查 API 地址和配置。'); }
  });
  ctx.on('dispose', () => {
    disposed = true;
    controller?.dispose();
    // Initialization may still be reading a large local dictionary; it observes disposed before constructing a client.
  });
}

module.exports = { name, usage, Config, apply, defaults, redact };
