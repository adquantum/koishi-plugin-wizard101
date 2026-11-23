'use strict';

const views = require('./views.cjs');
const { schoolName, SCHOOLS } = require('./catalog.cjs');
const { cleanText } = require('./format.cjs');

const TYPE_NAMES = { item: '装备', spell: '法术', mob: '怪物', pet: '宠物', fish: '鱼类', statcaps: '属性上限' };
const LABELS = {
  requirements: '使用要求', flags: '标记', rarity_label: '稀有度', deck_school_label: '牌组专属学派',
  spell_kind_label: '法术类型', availability: '用途限制', rank_label: '魔豆消耗', extracts: '怪物学采集',
  stun_beguile_label: '眩晕与魅惑', talent_layout: '天赋排列规则', effect_warnings: '效果解析说明',
  ppc: '超级豆概率', shad_rating: '暗影评级', hp: '生命值', outgoing: '对外治疗', incoming: '接受治疗',
  value: '数值', unit: '单位', percent: '百分比', rating: '评级', max_tcs: '副牌容量',
  spell_effects_available: '已收录效果树', effect_unparsed: '尚未解释的效果', type_name: '效果类型', reason: '说明', raw: '原始参数',
  talent_name: '天赋名称', kinds: '装备种类', pips: '普通豆', power_pips: '超级豆', heal_modifier: '治疗修正',
  num_targets: '目标数', effect_count: '效果条数', condition: '触发条件', parent_id: '上级效果 ID',
  spell_accuracy: '命中率',
};
const HIDDEN = new Set(['type', 'id', 'template_id', 'name', 'zh', 'name_zh', 'name_ref', 'display_name_ref', 'aliases', 'source', 'object_name', 'real_name', 'kimerith_revision', 'row_id', 'local_only', 'id_scope', 'portrait', 'stat_units', 'stat_record_counts', 'units', 'parsed_stats', 'unparsed_stats', 'native_stats', 'combat', 'description_raw', 'description_parsed', 'description_zh', 'effect_variants', 'effect_rows', 'effect_fields', 'effect_warnings', 'uses_energy', 'rank_label', 'extra_flags', 'kind_raw', 'form_raw', 'pve_raw', 'pvp_raw', 'monstro', 'jewels', 'stunnable_raw', 'rarity', 'stats_scope']);

function plain(value, limit = 16000) { return cleanText(value, limit); }
function sourceFooter(catalog) {
  const s = catalog.source || {};
  return `来源：${plain(s.name || '本地游戏资料', 90)}${s.version ? ' · ' + plain(s.version, 70) : ''}${s.synthetic ? ' · 合成示例，非实际游戏数据' : ''}\nKimerith 中文版 · 源逻辑 3c24847d`;
}
function label(name) { return LABELS[name] || views.FIELDS[name] || SCHOOLS[name] || name; }
function basicRows(entry) {
  return [{ label: '条目 ID', value: entry.id }, ...(entry.object_name ? [{ label: '内部名称', value: entry.object_name }] : [])];
}
function localizedRows(value, dict) {
  return views.entityRows(value, dict, { maxRows: 131072, maxArray: 4096, maxDepth: 10, maxText: 1024 * 1024 }).map(row => ({ ...row, label: row.label.split(' · ').map(part => {
    const match = /^(.*?)( \d+)?$/.exec(part);
    return label(match[1]) + (match[2] || '');
  }).join(' · ') }));
}
function statRows(stats) {
  return (stats || []).map(stat => ({
    label: plain(stat.label || stat.name || stat.string || '未识别属性', 160),
    value: plain(stat.text ?? `${stat.value ?? '未提供'}${stat.unit === 'percent' ? '%' : ''}`),
    icon: stat.icon || '',
  }));
}

function details(entry, dict, catalog, options = {}) {
  const names = views.displayName(entry, dict), sections = [];
  const fields = Object.fromEntries(Object.entries(entry).filter(([key]) => !HIDDEN.has(key) && !/token|api.?key|password|secret|authorization|cookie|html|binary|texture|mesh/i.test(key)));
  if (entry.type === 'spell') {
    if (entry.spell_kind_label) delete fields.kind;
    delete fields.description;
    delete fields.rank;
    fields.rank_label = entry.rank_label ?? (entry.x_pips ? 'X' : entry.rank);
    if (entry.uses_energy) delete fields.accuracy;
    else {
      delete fields.energy;
      if (fields.accuracy !== undefined) { fields.spell_accuracy = `${fields.accuracy}%`; delete fields.accuracy; }
    }
    const targetCount = options.num_targets ?? 1;
    const variant = entry.effect_variants?.find(v => v.num_targets === targetCount) || entry.effect_variants?.find(v => v.num_targets === 0);
    const effect = options.show_spell_effects ? variant?.text : entry.description_zh || entry.description_parsed || entry.description;
    sections.push({ title: options.show_spell_effects ? `法术效果 · ${targetCount} 个目标` : '法术说明', rows: [{ label: '', value: effect || (options.show_spell_effects ? '尚无效果树数据，请使用 v0.3 导入器重新导入包含 spell_effects 的数据库。' : '数据库未提供说明。') }] });
    if (entry.effect_warnings?.length) sections.push({ title: '解析说明', rows: entry.effect_warnings.map(value => ({ label: '', value })) });
  }
  if (entry.native_stats?.length) {
    delete fields.stats;
    sections.push({ title: '装备属性', rows: statRows(entry.native_stats) });
  }
  if (entry.type === 'mob' && entry.combat) {
    delete fields.stats;
    sections.push({ title: '怪物本体与装备属性', rows: statRows(entry.combat.display_stats || entry.combat.raw_stats) });
    if (entry.combat.warnings?.length) sections.push({ title: '汇总说明', rows: entry.combat.warnings.map(value => ({ label: '', value })) });
  }
  sections.unshift({ title: `${TYPE_NAMES[entry.type] || '条目'}资料`, rows: [...basicRows(entry), ...localizedRows(fields, dict)] });
  const reply = views.replyFromModel({ kind: entry.type, ...names, school: schoolName(entry.school || '', { allowUnknown: true }), portrait: entry.portrait || '', sections, footer: sourceFooter(catalog), maxPages: 100000, complete: true });
  if (options.match && !options.match.exact) {
    const note = `未找到精确名称“${plain(options.match.query, 80)}”；按相近名称匹配“${plain(options.match.matched, 120)}”。`;
    reply.pages[0].text = `${note}\n${reply.pages[0].text}`;
    reply.pages[0].card.sections.unshift({ title: '名称匹配', rows: [{ label: '', value: note }] });
  }
  return reply;
}

function deck(entry, dict, catalog) {
  const names = views.displayName(entry, dict);
  const cards = (entry.deck || []).map((card, index) => {
    const named = views.displayName(card, dict);
    return { label: String(index + 1), value: `${named.title}${named.subtitle ? ' / ' + named.subtitle : ''} ×${card.count ?? '未提供张数'}${card.object_name ? '\n' + card.object_name : ''}` };
  });
  if (!cards.length) cards.push({ label: '收录情况', value: '本地资料没有已收录牌组，不代表怪物没有法术。' });
  return views.replyFromModel({ kind: 'mob', title: names.title + ' · 牌组', subtitle: names.subtitle, school: entry.school, portrait: entry.portrait || '', sections: [{ title: '怪物与装备牌组', rows: cards }], footer: sourceFooter(catalog), maxPages: 100000, complete: true });
}

function list(result, type, dict, catalog) {
  const source = sourceFooter(catalog);
  // Keep only small page models. PNGs and full text are generated on demand.
  const groups = []; let current = [], cost = 0, ordinal = 0;
  for (const entry of result.items) {
    const names = views.displayName(entry, dict);
    const value = result.object ? entry.object_name : `${names.title}${names.subtitle ? ' / ' + names.subtitle : ''}`;
    const row = { label: String(++ordinal), value, id: entry.id };
    if (current.length && (current.length >= 15 || cost + value.length + 8 > 550)) { groups.push(current); current = []; cost = 0; }
    current.push(row); cost += value.length + 8;
  }
  if (current.length || !groups.length) groups.push(current);
  const pages = [];
  for (const rows of groups) {
    const model = { kind: type, title: `${TYPE_NAMES[type]}列表`, subtitle: `${plain(result.query, 100)} · 共 ${result.total} 个不同名称`, sections: [{ title: result.object ? '内部 Object 名' : '名称', rows: rows.length ? rows : [{ label: '结果', value: '当前资料包没有符合条件的记录。' }] }], footer: source };
    // Pagination does not discard the remainder; the complete name list stays reachable.
    for (const page of views.modelPages(model)) pages.push(page.card);
  }
  return { kind: 'wizard101.reply', pageCount: pages.length, getPage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= pages.length) throw new Error('查询页码超出当前列表。');
    return views.modelPages(pages[index])[0];
  } };
}

function calculation(result, input, { entry, dict, catalog } = {}) {
  const n = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 });
  const rows = [{ label: '未暴击伤害', value: n.format(result.normal), icon: 'stat.damage' }, { label: '暴击伤害', value: n.format(result.critical), icon: 'stat.critical' }, { label: '暴击倍率', value: n.format(result.multiplier) }];
  const values = { ...input, ...(result.target ? { resist: result.target.resist, block: result.target.block } : {}) };
  const params = Object.entries(values).filter(([key]) => !['name', 'search_by'].includes(key)).map(([key, value]) => ({ label: ({ base: '基础伤害', damage: '面板伤害加成', pierce: '穿透', critical: '暴击评级', resist: '抗性', block: '格挡评级', buffs: '增减益顺序', pvp: 'PvP 模型', school: '攻击学派' })[key] || key, value: typeof value === 'boolean' ? (value ? '是' : '否') : key === 'school' ? (SCHOOLS[value] || String(value)) : `${value}${['damage', 'pierce', 'resist'].includes(key) ? '%' : ''}` }));
  const stages = (result.stages || []).map(step => ({ label: step.label || step.name || '步骤', value: typeof step.value === 'number' ? n.format(step.value) : plain(step.value ?? step.description ?? '') }));
  const notices = [...(result.assumptions || []), ...(result.warnings || [])];
  const title = entry ? `${views.displayName(entry, dict).title} · 伤害计算` : 'Kimerith 伤害计算';
  return views.replyFromModel({ kind: 'calc', title, subtitle: input.pvp === false ? 'PvE · 上游兼容计算规则' : 'PvP · 上游兼容计算规则', school: input.school || entry?.school, portrait: entry?.portrait || '', sections: [{ title: '计算结果', rows }, { title: '输入参数', rows: params }, ...(stages.length ? [{ title: '计算过程', rows: stages }] : []), { title: '计算口径', rows: notices.map(value => ({ label: '', value })) }], footer: catalog ? sourceFooter(catalog) : '算法：Kimerith-WindHammer 3c24847d · 兼容参考实现，不代表游戏服务器实时版本。', maxPages: 200 });
}

module.exports = { details, deck, list, calculation, sourceFooter, statRows, TYPE_NAMES };
