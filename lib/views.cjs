'use strict';

const format = require('./format.cjs');
const { entityName, entityId } = require('./api.cjs');
const { SCHOOLS, schoolName } = require('./catalog.cjs');

const LABELS = Object.freeze({ ...format.LABELS, pet: '宠物', fish: '鱼类', statcaps: '等级属性上限', calc: '伤害估算' });
const FIELDS = Object.freeze({ ...format.FIELD_LABELS,
  zh: '中文名称', name_zh: '中文名称', object_name: '内部名称', real_name: '内部名称', kind: '种类', equip_school: '需求学派', equip_level: '需求等级', equip_secondary: '魔法编织要求',
  strength: '力量', intellect: '智力', agility: '敏捷', will: '意志', power: '能量', wow_factor: 'Wow Factor', exclusive: '专属宠物', egg: '宠物蛋', egg_name: '宠物蛋', derby_talents: '竞速天赋',
  base_length: '基础长度', min_size: '最小长度系数', max_size: '最大长度系数', min_length: '最小长度', max_length: '最大长度', speed: '移动速度', bite_seconds: '咬钩时间（秒）', initial_bite_chance: '初始咬钩参数', incremental_bite_chance: '咬钩增长参数', is_sentinel: '哨兵鱼',
  damage_percent: '伤害加成', resist_percent: '抗性百分比', accuracy_percent: '命中加成', pierce_percent: '穿透', power_pip_percent: '超级豆概率', critical_rating: '暴击评级', block_rating: '格挡评级',
  flat_damage: '固定伤害', flat_resist: '固定减伤', outgoing_percent: '对外治疗', incoming_percent: '接受治疗', pip_conversion: '魔豆转换评级', shadow_rating: '暗影评级', archmastery: '精通评级', archmastery_points: '精通点数',
  max_pips: '起手普通豆', max_power_pips: '起手超级豆', x_pips: 'X 豆法术', max_spells: '牌组容量', max_copies: '同名牌上限', max_school_copies: '本系同名牌上限', max_tcs: '宝藏卡容量', deck_school: '牌组学派',
  fire_pips: '火焰豆', ice_pips: '寒冰豆', storm_pips: '风暴豆', myth_pips: '神话豆', life_pips: '生命豆', death_pips: '死亡豆', balance_pips: '平衡豆',
  pve: 'PvE 参数', pvp: 'PvP 参数', levelreq: '需求等级', form: '法术种类', energy: '能量消耗', stunnable: '可眩晕', has_cheats: '有特殊机制', max_shadow: '暗影豆上限',
  intelligence: 'AI 智能参数', selfishness: 'AI 自利参数', aggressiveness: 'AI 进攻参数', set_name: '套装', set_id: '套装 ID', maycasts: 'Maycast 法术', notes: '数据说明', restrictions: '使用限制',
  flags_raw: '原始标记', school_restriction: '学派限制', locked: '锁定', shape: '形状', count: '数量', school: '学派',
  unparsed_stats: '未解析属性记录', stats_scope: '属性范围', archmastery_rating: '精通评级', resist_rating: '抗性评级', accuracy_rating: '命中评级', passengers: '乘坐人数', speed_multiplier: '原始速度倍率',
  priority: '优先级', description_id: '说明文本 ID', parsed_stats: '已解析属性记录', unresolved: '尚未解析',
});
const STAT_ICONS = { health: 'stat.health', hp: 'stat.health', max_health: 'stat.health', mana: 'stat.mana', damage: 'stat.damage', damage_percent: 'stat.damage', flat_damage: 'stat.damage', resist: 'stat.resist', resistance: 'stat.resist', resist_percent: 'stat.resist', flat_resist: 'stat.resist', accuracy: 'stat.accuracy', accuracy_percent: 'stat.accuracy', critical: 'stat.critical', critical_rating: 'stat.critical', block: 'stat.block', critical_block: 'stat.block', block_rating: 'stat.block', pierce: 'stat.pierce', pierce_percent: 'stat.pierce', power_pip_percent: 'pip.power', power_pips: 'pip.power', max_power_pips: 'pip.power', pips: 'pip.normal', rank: 'pip.normal', max_pips: 'pip.normal', shadow_pips: 'pip.shadow', shadow_rating: 'pip.shadow', incoming_healing: 'stat.incoming', outgoing_healing: 'stat.outgoing', incoming_percent: 'stat.incoming', outgoing_percent: 'stat.outgoing' };
Object.assign(STAT_ICONS, { spell_accuracy: 'stat.accuracy', rank_label: 'pip.normal', strength: 'pet.strength', intellect: 'pet.intellect', agility: 'pet.agility', will: 'pet.will', power: 'pet.power', archmastery: 'stat.archmastery', archmastery_points: 'stat.archmastery', archmastery_rating: 'stat.archmastery', pip_conversion: 'stat.pip_conversion', energy: 'stat.energy', stun_resist: 'stat.stun_resist', speed: 'stat.speed', flat_damage: 'stat.flat_damage', flat_resist: 'stat.flat_resist' });
const KINDS = { hat: '帽子', robe: '长袍', shoes: '靴子', boots: '靴子', weapon: '法杖', wand: '法杖', athame: '短剑', amulet: '护符', ring: '戒指', deck: '牌组', jewel: '宝石', mount: '坐骑', circle: '圆形', square: '方形', triangle: '三角形', octagon: '八角形', tear: '泪形', power_pin: '力量别针', shield_pin: '盾形别针', sword_pin: '剑形别针' };
const HIDDEN = /(?:^_|token|api.?key|authorization|cookie|password|secret|html|binary|texture|nif|model|mesh|vertices|image|icon|portrait|raw_data)/i;
const ID_FIELDS = new Set(['id', 'template_id', 'templateId', 'type', 'name', 'display_name', 'displayName', 'name_ref', 'display_name_ref', 'name_key', 'display_name_key', 'zh', 'name_zh', 'aliases', 'source', 'row_id', 'local_only', 'stat_units', 'stat_record_counts']);
const ROWS_PER_PAGE = 10;
const TEXT_PAGE_SIZE = 1050;

function text(value, limit = 400) { return format.cleanText(value, limit); }
function fieldName(key) { return FIELDS[key] || SCHOOLS[key] || key; }

function displayName(entity, dict) {
  const english = text(entityName(entity), 180) || '未命名条目';
  const explicit = typeof (entity.zh ?? entity.name_zh) === 'string' ? text(entity.zh ?? entity.name_zh, 100) : '';
  const translated = explicit || text(dict?.translate(english, entity.name_ref ?? entity.display_name_ref)?.text || '', 100);
  return { title: translated && translated !== english ? translated : english, subtitle: translated && translated !== english ? english : '' };
}

function asValue(value, key, dict, maxText = 16000) {
  if (value === null) return '未提供';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return `${value}${/(?:_percent|_pct)$/.test(key) ? '%' : ''}`;
  const full = text(value, maxText + 1);
  const raw = full.length > maxText ? full.slice(0, maxText) + `\n字段超过 ${maxText} 字符，后续请查看资料源。` : full;
  if (key === 'unit') return ({ percent: '百分比', rating: '评级', exported_rating: '导出评级', count: '数量', raw: '原始值', seconds: '秒' })[raw] || raw;
  if (key === 'stats_scope' && raw === 'base_only') return '怪物本体（尚未合并装备）';
  if (/school/.test(key)) { const s = schoolName(raw, { allowUnknown: true }); return SCHOOLS[s] ? `${SCHOOLS[s]} (${s})` : raw; }
  if (/^(kind|slot|shape|item_type)$/.test(key) && Object.hasOwn(KINDS, raw.toLowerCase())) return `${KINDS[raw.toLowerCase()]} (${raw})`;
  if (/name|world|talent|egg/.test(key) && raw.length <= 180 && dict) return format.bilingual(raw, dict);
  return raw;
}

function entityRows(entity, dict, { maxRows = 120, maxArray = 80, maxDepth = 5, maxText = 16000 } = {}) {
  const rows = [];
  let omitted = 0;
  function walk(value, path, key, depth, inheritedIcon = '') {
    if (rows.length >= maxRows || depth > maxDepth) { omitted++; return; }
    const icon = STAT_ICONS[key] || (Object.hasOwn(SCHOOLS, key) ? `school.${key}` : inheritedIcon);
    if (value === undefined) return;
    if (value && typeof value === 'object' && !Array.isArray(value) && ['tear', 'circle', 'square', 'triangle', 'octagon', 'power_pin', 'shield_pin', 'sword_pin'].includes(value.shape)) {
      rows.push({ label: text(path, 160), value: `${KINDS[value.shape]}${value.locked === true ? ' · 已锁定' : value.locked === false ? ' · 未锁定' : ' · 锁定状态未提供'}`, icon: `socket.${value.shape}${value.locked === true ? '.locked' : ''}` });
      for (const [childKey, child] of Object.entries(value)) {
        if (!['shape', 'locked'].includes(childKey) && !HIDDEN.test(childKey)) walk(child, `${path} · ${fieldName(childKey)}`, childKey, depth + 1, icon);
      }
      return;
    }
    if (value === null || typeof value !== 'object') {
      const v = asValue(value, key, dict, maxText);
      if (v) rows.push({ label: text(path, 160), value: v, icon });
      return;
    }
    if (Array.isArray(value)) {
      if (!value.length) { rows.push({ label: path, value: '未提供条目', icon }); return; }
      value.slice(0, maxArray).forEach((entry, i) => {
        if (rows.length >= maxRows) { omitted++; return; }
        if (entry && typeof entry === 'object' && typeof entry.name === 'string') {
          const named = displayName(entry, dict);
          let id = '';
          try { id = entityId(entry) || ''; } catch (_) { /* Preserve a readable name without inventing an ID. */ }
          const itemPath = `${path} ${i + 1}`;
          const count = Object.hasOwn(entry, 'count') ? ` ×${asValue(entry.count, 'count', dict)}` : '';
          rows.push({ label: itemPath, value: `${named.title}${named.subtitle ? ` / ${named.subtitle}` : ''}${id ? ` [${id}]` : ''}${count}`, icon });
          for (const [childKey, child] of Object.entries(entry)) {
            if (ID_FIELDS.has(childKey) || childKey === 'count' || HIDDEN.test(childKey)) continue;
            walk(child, `${itemPath} · ${fieldName(childKey)}`, childKey, depth + 1, icon);
          }
        } else walk(entry, `${path} ${i + 1}`, key, depth + 1, icon);
      });
      if (value.length > maxArray) omitted += value.length - maxArray;
      return;
    }
    for (const [childKey, child] of Object.entries(value)) {
      if (HIDDEN.test(childKey) || (depth === 0 && ID_FIELDS.has(childKey))) continue;
      if (depth === 0 && ['drops', 'cheats', 'deck'].includes(childKey)) continue;
      walk(child, path ? `${path} · ${fieldName(childKey)}` : fieldName(childKey), childKey, depth + 1, icon);
    }
  }
  walk(entity, '', '', 0);
  if (omitted) rows.push({ label: '更多字段', value: `另有 ${omitted} 组字段超出展示上限，请查看资料源。` });
  return rows.length ? rows : [{ label: '资料', value: '来源没有提供其他可显示字段。' }];
}

function splitLongRows(rows) {
  const result = [];
  for (const row of rows) {
    const points = Array.from(String(row.value ?? ''));
    if (!points.length) continue;
    for (let i = 0; i < points.length; i += 100) result.push({ ...row, label: `${row.label}${i ? '（续）' : ''}`, value: points.slice(i, i + 100).join('') });
  }
  return result;
}

function modelPages(model) {
  model = { ...model, title: text(model.title, 140), subtitle: text(model.subtitle, 180), footer: text(model.footer, 300) };
  const maxPages = Number.isSafeInteger(model.maxPages) ? Math.min(100000, Math.max(1, model.maxPages)) : 30;
  const header = `【${LABELS[model.kind] || 'Wizard101'}】${model.title}${model.subtitle ? `\n${model.subtitle}` : ''}`;
  const bodyBudget = Math.max(160, TEXT_PAGE_SIZE - header.length - model.footer.length - 70);
  const groups = [];
  let current = [], count = 0, chars = 0;
  for (const section of model.sections || []) for (const row of splitLongRows(section.rows || [])) {
    const cost = row.label.length + row.value.length + 8;
    if (current.length && (count >= ROWS_PER_PAGE || chars + cost > bodyBudget)) { groups.push(current); current = []; count = 0; chars = 0; }
    let group = current.at(-1);
    if (!group || group.title !== section.title) current.push(group = { title: section.title || '', rows: [] });
    group.rows.push(row); count++; chars += cost;
  }
  if (current.length || !groups.length) groups.push(current);
  if (model.complete && groups.length > maxPages) throw new Error(`查询回复超过 ${maxPages} 页，未丢弃尾部内容；请使用更精确的筛选条件。`);
  return groups.slice(0, maxPages).map((sections, index) => {
    const card = { ...model, sections };
    const body = sections.flatMap(s => [...(s.title ? [`\n${s.title}`] : []), ...s.rows.map(r => `${r.label}：${r.value}`)]).join('\n');
    const suffix = groups.length > maxPages && index === maxPages - 1 ? '\n记录过长，后续请查看资料源。' : '';
    return { text: `${header}\n${body}${suffix}\n${model.footer || ''}`.trim(), card, summary: `${model.title}${model.subtitle ? ` / ${model.subtitle}` : ''}` };
  });
}

function replyFromModel(model) { return { kind: 'wizard101.reply', pages: modelPages(model) }; }

function sourceFooter({ source = 'Wizard404', sourceUrl, version = '', synthetic = false, fetchedAt, cacheHit = false } = {}) {
  const sourceLine = `来源：${text(source, 120)}${version ? ` · ${text(version, 80)}` : ''}${cacheHit ? '（缓存）' : ''}${synthetic ? ' · 合成示例，非实际游戏数据' : ''}`;
  return [sourceLine, sourceUrl || '', Number.isFinite(fetchedAt) ? `获取时间：${new Date(fetchedAt).toISOString()}` : ''].filter(Boolean).join('\n');
}

function detailReply(type, id, entity, dict, { source = 'Wizard404', sourceUrl, version = '', synthetic = false, fetchedAt, cacheHit = false, prefix = 'wiz' } = {}) {
  const names = displayName(entity, dict);
  const school = schoolName(entity.school ?? entity.school_name ?? entity.equip_school ?? '', { allowUnknown: true });
  const footer = sourceFooter({ source, sourceUrl, version, synthetic, fetchedAt, cacheHit });
  const rows = [{ label: '条目 ID', value: id }, ...entityRows(entity, dict)];
  if (type === 'mob') rows.push({ label: '继续查询', value: `${prefix}.drops ${id} / ${prefix}.cheats ${id} / ${prefix}.deck ${id}` });
  return replyFromModel({ kind: type, ...names, school, sections: [{ title: LABELS[type] + '资料', rows }], footer });
}

function relationReply(id, relationType, data, dict, options = {}) {
  const title = { drops: '掉落', cheats: '特殊机制', deck: '牌组' }[relationType];
  const payload = data?.[relationType] ?? data;
  let rows = [];
  if (relationType === 'cheats') {
    const markdown = typeof payload === 'string' ? payload : [payload?.markdown, payload?.cheats_markdown, payload?.effective_markdown, payload?.text].find(v => typeof v === 'string' && v.trim());
    if (typeof markdown === 'string' && markdown.trim()) rows.push({ label: '机制原文（尚未人工翻译）', value: asValue(markdown, 'description', dict) });
    else if (payload && typeof payload === 'object' && Object.keys(payload).length) rows = entityRows(payload, dict);
    else rows.push({ label: '收录情况', value: '来源尚未收录可读的机制说明；不代表此怪物没有特殊机制。' });
  } else if (relationType === 'deck') {
    const cards = Array.isArray(payload) ? payload : payload?.cards ?? payload?.spells ?? payload?.deck;
    if (Array.isArray(cards)) {
      rows = cards.length ? entityRows({ cards: cards.map(card => card && typeof card === 'object' ? { ...card, count: card.count ?? '未提供张数' } : card) }, dict) : [{ label: '收录情况', value: '来源尚未收录可抽取卡牌，不代表怪物没有法术。' }];
    } else rows = entityRows(payload, dict);
  } else {
    rows = entityRows(payload, dict);
    const unresolved = payload?.loot_table_groups?.filter?.(group => group?.is_resolved === false).length;
    if (unresolved) rows.unshift({ label: '解析情况', value: `有 ${unresolved} 张掉落表尚未解析。` });
    rows.push({ label: '收录说明', value: '空列表表示尚无已知记录。未给出概率的掉落不会推算概率；宝箱和关联来源按返回分组保留。' });
  }
  return replyFromModel({ kind: 'mob', title: `怪物${title}`, subtitle: `ID ${id}`, school: options.school || '', sections: [{ title, rows }], footer: sourceFooter({ ...options, sourceUrl: options.sourceUrl || format.sourceUrl('mob', id) }) });
}

function compareReply(leftId, left, rightId, right, dict, options = {}) {
  const aName = displayName(left, dict), bName = displayName(right, dict);
  const a = format.numericStats(left), b = format.numericStats(right);
  const common = [...a.keys()].filter(key => b.has(key));
  const rows = [{ label: 'A', value: `${aName.title}${aName.subtitle ? ` / ${aName.subtitle}` : ''} [${leftId}]` }, { label: 'B', value: `${bName.title}${bName.subtitle ? ` / ${bName.subtitle}` : ''} [${rightId}]` }];
  for (const key of common) {
    const diff = Number((b.get(key) - a.get(key)).toPrecision(12));
    const unit = /(?:_percent|_pct)$/.test(key) ? '%' : '';
    rows.push({ label: key.split('.').map(fieldName).join(' · '), value: `${a.get(key)}${unit} → ${b.get(key)}${unit}（B−A ${diff >= 0 ? '+' : ''}${diff}${unit}）`, icon: STAT_ICONS[key.split('.').at(-1)] || '' });
  }
  rows.push({ label: '比较口径', value: common.length ? '只比较相同路径的数值字段；不把缺失值当作 0，不换算评级、叠加通用属性或判断配装强弱。每件最多读取 100 个数值字段。' : '两条记录没有同路径的可比数值属性；不把缺失值当作 0。请分别查看物品详情。' });
  return replyFromModel({ kind: 'item', title: '装备属性对比', sections: [{ title: 'A → B', rows }], footer: sourceFooter(options) });
}

function searchReply(type, query, result, dict, { source = '本地资料包', prefix = 'wiz', filters = {}, synthetic = false } = {}) {
  const filtered = Object.entries(filters).map(([k, v]) => `${fieldName(k)}=${v}`).join(' · ');
  const rows = result.items.map((e, i) => { const names = displayName(e, dict); return { label: `${i + 1}`, value: `${names.title}${names.subtitle ? ` / ${names.subtitle}` : ''}\nID ${e.id ?? e.template_id}`, icon: e.school ? `school.${schoolName(e.school, { allowUnknown: true })}` : '' }; });
  if (!rows.length) rows.push({ label: '结果', value: '当前资料包没有符合条件的条目；不代表游戏中不存在。' });
  rows.push({ label: '操作', value: `${prefix}.pick 1 查看；${prefix}.prev / ${prefix}.next 翻页；${prefix}.first / ${prefix}.last 首末页` });
  return replyFromModel({ kind: type, title: `${LABELS[type]}检索`, subtitle: `${query || '全部'} · 第 ${result.page}/${result.totalPages} 页 · 共 ${result.total} 项${filtered ? ` · ${filtered}` : ''}`, school: filters.school || '', sections: [{ title: '', rows }], footer: `来源：${source}${synthetic ? ' · 合成示例，非实际游戏数据' : ''}` });
}

function splitText(value) {
  const lines = String(value ?? '').split('\n');
  const pages = [];
  let current = '';
  for (const line of lines) {
    const pieces = [];
    const points = Array.from(line);
    for (let i = 0; i < points.length; i += TEXT_PAGE_SIZE) pieces.push(points.slice(i, i + TEXT_PAGE_SIZE).join(''));
    if (!pieces.length) pieces.push('');
    for (const piece of pieces) {
      if (current && Array.from(current).length + Array.from(piece).length + 1 > TEXT_PAGE_SIZE) { pages.push(current); current = ''; }
      current += (current ? '\n' : '') + piece;
    }
  }
  if (current || !pages.length) pages.push(current);
  const limited = pages.slice(0, 30);
  if (pages.length > 30) limited[29] += '\n回复超过 30 页展示上限，后续请查原始资料源。';
  return limited.map(text => ({ text, summary: text.split('\n')[0] }));
}

function textReply(value, { title = 'Wizard101 查询', kind = 'text', school = '' } = {}) {
  const rows = String(value ?? '').split('\n').filter(Boolean).map(line => {
    const at = line.indexOf('：');
    return at > 0 && at < 45 ? { label: line.slice(0, at), value: line.slice(at + 1) } : { label: '', value: line };
  });
  return replyFromModel({ kind, title, subtitle: '', school, sections: [{ title: '', rows }], footer: 'Wizard101 中文百科' });
}

module.exports = { LABELS, FIELDS, displayName, entityRows, detailReply, relationReply, compareReply, searchReply, replyFromModel, textReply, splitText, modelPages };
