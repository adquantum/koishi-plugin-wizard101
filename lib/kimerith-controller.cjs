'use strict';

const { BotController } = require('./bot-controller.cjs');
const { sessionKey } = require('./controller.cjs');
const { KimerithSearch, bool } = require('./kimerith-search.cjs');
const { schoolName } = require('./catalog.cjs');
const views = require('./views.cjs');
const kviews = require('./kimerith-views.cjs');
const { getPlatform, neutralizeMentions, textCost } = require('./platform.cjs');

const ROUTES = Object.freeze(['item.find', 'item.list', 'spell.find', 'spell.list', 'mob.find', 'mob.list', 'mob.deck', 'mob.calc', 'pet.find', 'pet.list', 'fish.find', 'fish.list', 'statcaps.find', 'calc', 'help']);

function inputNumber(value, name) {
  if (value === undefined || value === null || value === '') throw new Error(`请输入 ${name} 参数。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error(`请输入整数 ${name} 参数。`);
  return number;
}

function damageParameters(params, target = false) {
  const input = {};
  for (const key of target ? ['base', 'damage', 'pierce', 'critical'] : ['base', 'damage', 'pierce', 'critical', 'resist', 'block']) input[key] = inputNumber(params[key], key);
  input.buffs = String(params.buffs ?? '').trim();
  input.pvp = bool(params.pvp, true);
  if (target) {
    input.school = schoolName(params.school || '');
    if (!input.school || ['universal', 'gardening', 'fishing', 'cantrips', 'castlemagic', 'whirlyburly'].includes(input.school)) throw new Error('请输入有效的攻击学派 school。');
  }
  return input;
}

class KimerithController extends BotController {
  constructor(config, dict, api, catalog) {
    super(config, dict, api, catalog);
    this.kimerithSearch = new KimerithSearch(this.catalog, dict);
  }

  localDetail(type, entity) {
    if (Object.hasOwn(kviews.TYPE_NAMES, type)) return kviews.details(entity, this.dict, this.catalog);
    return super.localDetail(type, entity);
  }

  help() {
    const p = this.config.command;
    return `【Kimerith 中文版 · Wizard101 图鉴】\n` + [
      `${p}.item.find 名称 / ${p}.item.list 关键词：装备属性与列表`,
      `${p}.spell.find --effects true --targets 2 名称：法术效果树`,
      `${p}.spell.list 关键词：法术列表`,
      `${p}.mob.find 名称 / ${p}.mob.list 关键词：怪物与装备汇总属性`,
      `${p}.mob.deck 名称：怪物牌组`,
      `${p}.mob.calc -s fire --base 1000 -d 100 -p 20 -c 500 名称：对怪物计算`,
      `${p}.pet.find 名称 / ${p}.pet.list 关键词：宠物、普通与竞速天赋`,
      `${p}.fish.find 名称 / ${p}.fish.list 关键词：鱼类资料`,
      `${p}.statcaps.find 170 fire：十级档位属性上限（与上游相同）`,
      `${p}.calc 1000 -d 100 -p 20 -c 500 -r 30 --block 200 --buffs "35 -50"：上游兼容计算`,
      `${p}.estimate 1000 -d 100 -b 40：v0.2 简化计算器`,
      `${p}.page 2：详情翻页；${p}.pick / next / prev：旧检索指令仍可用`,
      'find 支持 --search-by Name/Object/ID；list 用 * 列出全部名称。',
      '中文、繁体、英文均可检索；没有精确名称时会明确标示相近匹配。',
      'Discord 支持原生斜线指令与四按钮分页，需管理员先执行同步。',
      '参考算法版本：Kimerith-WindHammer 3c24847d；GPL-3.0。',
    ].join('\n');
  }

  async execute(session, route, params = {}) {
    if (!ROUTES.includes(route)) throw new Error('查询命令不存在。');
    if (route === 'help') return views.textReply(this.help(), { title: 'Kimerith 中文版帮助' });
    if (route === 'calc') {
      const { calculateKimerithDamage } = require('./kimerith-math.cjs');
      const input = damageParameters(params);
      return kviews.calculation(calculateKimerithDamage(input), input);
    }
    if (route === 'statcaps.find') return this.kimerithStatcaps(params);
    const [type, operation] = route.split('.');
    if (!this.catalog.has(type)) return views.textReply(this.missingCatalog(type), { title: '需要本地游戏资料' });
    if (operation === 'list') return kviews.list(this.kimerithSearch.list(type, params), type, this.dict, this.catalog);
    const result = this.kimerithSearch.find(type, operation === 'calc' ? { name: params.name, search_by: params.search_by } : params);
    if (!result.items.length) return views.textReply(`当前资料包中没有匹配的${kviews.TYPE_NAMES[type]}。\n名称或 ID：${String(params.name || '')}\n请检查筛选条件与数据库版本。`, { title: '没有查询结果' });
    const options = { match: result };
    if (type === 'spell') {
      options.show_spell_effects = bool(params.show_spell_effects, false);
      options.num_targets = params.num_targets === undefined ? 1 : inputNumber(params.num_targets, 'num_targets');
      if (options.num_targets < 0 || options.num_targets > 10000) throw new Error('请输入 0–10000 的 num_targets 整数。');
    }
    const replies = [];
    for (const entry of result.items) {
      if (operation === 'deck') replies.push(kviews.deck(entry, this.dict, this.catalog));
      else if (operation === 'calc') {
        const { calculateKimerithMobDamage } = require('./kimerith-math.cjs');
        const input = damageParameters(params, true);
        if (!entry.combat || !entry.combat.complete) {
          replies.push(views.textReply(`怪物 ${entry.name} 的本体／装备汇总资料不完整。请用 v0.3 导入器重新导出包含 mob_stats、mob_items 和 item_stats 的资料库。未把缺失的装备属性当作零。`, { title: '无法完成目标伤害计算', kind: 'mob' }));
        } else {
          const calculation = calculateKimerithMobDamage({ ...input, mobCombat: entry.combat });
          replies.push(kviews.calculation(calculation, input, { entry, dict: this.dict, catalog: this.catalog }));
        }
      } else replies.push(kviews.details(entry, this.dict, this.catalog, options));
    }
    const pages = replies.flatMap(reply => reply.pages);
    return { kind: 'wizard101.reply', pageCount: pages.length, getPage(index) { return pages[index]; } };
  }

  kimerithStatcaps(params) {
    const input = inputNumber(params.level, 'level'), level = Math.trunc(input / 10) * 10;
    const school = schoolName(params.school || '');
    if (!['fire', 'ice', 'storm', 'myth', 'life', 'death', 'balance'].includes(school)) throw new Error('请输入七大基础学派之一。');
    if (level < 10 || level > 190) return views.textReply('Kimerith 的属性上限档位为 10–190 级，输入等级先向下取整到十级档位。', { title: '等级超出范围' });
    if (!this.catalog.has('statcaps')) return views.textReply(this.missingCatalog('statcaps'), { title: '需要属性上限数据' });
    const matches = this.catalog.search('statcaps', [], { school, level }, 1, 20).items;
    if (!matches.length) return views.textReply(`资料包未收录 ${school} ${level} 级的上限。可用档位：${this.catalog.levels(school).join('、') || '无'}。`, { title: '没有该档位记录' });
    const pages = matches.flatMap(entry => kviews.details(entry, this.dict, this.catalog).pages);
    if (input !== level) {
      const message = `按上游规则：输入 ${input} 级，查询 ${level} 级档位。`;
      pages[0].text = message + '\n' + pages[0].text;
      pages[0].card.subtitle = message;
    }
    return { kind: 'wizard101.reply', pages };
  }

  prepareReply(session, output) {
    if (output?.kind !== 'wizard101.reply' || typeof output.getPage !== 'function') return super.prepareReply(session, output);
    if (!Number.isSafeInteger(output.pageCount) || output.pageCount < 1 || output.pageCount > 100000) throw new Error('查询返回了无效页数。');
    for (const [key, value] of this.responses) if (value.expiresAt < Date.now()) this.responses.delete(key);
    while (this.responses.size >= 32) this.responses.delete(this.responses.keys().next().value);
    this.responses.set(sessionKey(session), { provider: output, expiresAt: Date.now() + 10 * 60 * 1000 });
    return this.responsePage(session, 1);
  }

  responsePage(session, rawPage) {
    const state = this.responses.get(sessionKey(session));
    if (!state?.provider) return super.responsePage(session, rawPage);
    if (state.expiresAt < Date.now()) return { text: '没有当前详情，或详情已过期。请重新查询。' };
    const page = Number(rawPage), total = state.provider.pageCount;
    if (!Number.isSafeInteger(page) || page < 1 || page > total) return { text: `当前回复只有 ${total} 页。` };
    const value = state.provider.getPage(page - 1);
    state.currentPage = page;
    const hint = `第 ${page}/${total} 页 · ${this.config.command}.page ${page < total ? page + 1 : 1}`;
    const text = value.text + (total > 1 ? '\n' + hint : '');
    const platform = getPlatform(session);
    if (textCost(neutralizeMentions(text, platform), platform) > 1800) {
      // A hostile Markdown-heavy page is expanded into reachable text subpages
      // using the existing encoding-aware paginator, never silently truncated.
      const split = new BotController(this.config, this.dict, { dispose() {} });
      split.prepareReply(session, value.text);
      const chunks = split.responses.get(sessionKey(session)).pages;
      const original = state.provider;
      state.provider = { pageCount: total + chunks.length - 1, getPage(index) { return index < page - 1 ? original.getPage(index) : index < page - 1 + chunks.length ? chunks[index - (page - 1)] : original.getPage(index - chunks.length + 1); } };
      // Do not dispose the temporary controller: its dictionary is shared.
      split.responses.clear();
      return this.responsePage(session, page);
    }
    return { ...value, text, summary: `${value.summary || value.text.split('\n')[0]}${total > 1 ? '\n' + hint : ''}`, card: value.card ? { ...value.card, footer: `${value.card.footer || ''}${total > 1 ? '\n' + hint : ''}` } : undefined, nextPage: page < total ? page + 1 : null };
  }

  responseNavigate(session, direction) {
    const state = this.responses.get(sessionKey(session));
    if (!state || state.expiresAt < Date.now()) return { text: '没有当前详情，或详情已过期。请重新查询。' };
    const total = state.provider?.pageCount || state.pages?.length || 1;
    const current = state.currentPage || 1;
    const page = direction === 'first' ? 1 : direction === 'last' ? total : direction === 'prev' ? Math.max(1, current - 1) : Math.min(total, current + 1);
    return this.responsePage(session, page);
  }
}

module.exports = { KimerithController, ROUTES, damageParameters, inputNumber };
