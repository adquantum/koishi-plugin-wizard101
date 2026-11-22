'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ICON_BYTES = 1024 * 1024;
const MAX_ICON_TOTAL = 16 * 1024 * 1024;
const MAX_FONT_BYTES = 64 * 1024 * 1024;
const CJK_PROBE = ['中', '文', '火', '冰', '雷', '图', '鑑'].map(char => char.codePointAt(0));
const SCHOOLS = Object.freeze({
  fire: ['火焰', '#f29c67'], ice: ['寒冰', '#9bd6f1'], storm: ['风暴', '#c5a4ed'],
  myth: ['神话', '#e6c85a'], life: ['生命', '#9bce99'], death: ['死亡', '#c9c7da'],
  balance: ['平衡', '#dbad7e'], sun: ['太阳', '#edce79'], moon: ['月亮', '#aac8e9'],
  star: ['星辰', '#cdd7a0'], shadow: ['暗影', '#c7afe1'], universal: ['全学派', '#dfc591'],
});
const KIND_LABELS = Object.freeze({ item: '装备与物品', gear: '装备与物品', spell: '法术图鉴', mob: '怪物档案',
  zone: '区域图鉴', npc: '人物档案', quest: '任务资料', talent: '天赋资料', pet: '宠物图鉴',
  recipe: '配方预览', event: '活动资料', compare: '装备比较', calc: '数值计算', dictionary: '中英词典' });

class CardUnavailableError extends Error {
  constructor(reason, message = '图片卡片暂不可用，请使用文字结果。') {
    super(message);
    this.name = 'CardUnavailableError';
    this.code = 'WIZ_CARD_UNAVAILABLE';
    this.reason = reason;
  }
}

function text(value, limit = 500) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  const clean = String(value).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/gu, '');
  const chars = Array.from(clean);
  return chars.length > limit ? chars.slice(0, Math.max(0, limit - 1)).join('') + '…' : clean;
}

function escapeXml(value) {
  return text(value, 20000).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
}

function widthOf(char, size) {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff00-\uffef]/u.test(char)) return size;
  if (/[WMwm@%#&]/.test(char)) return size;
  if (/[A-Z0-9]/.test(char)) return size * 0.75;
  return size * 0.62;
}

function wrapText(value, maxWidth, size, maxLines = 4) {
  const result = [];
  let line = '', width = 0;
  for (const char of text(value, 2000)) {
    const next = widthOf(char, size);
    if (char === '\n' || (line && width + next > maxWidth)) {
      result.push(line.trimEnd());
      line = ''; width = 0;
      if (result.length === maxLines) {
        result[maxLines - 1] = result[maxLines - 1].replace(/.{0,2}$/u, '') + '…';
        return result;
      }
      if (char === '\n') continue;
    }
    line += char; width += next;
  }
  if (line || !result.length) result.push(line.trimEnd());
  return result;
}

function normalizeModel(model, maxRows = 28) {
  if (!model || typeof model !== 'object') throw new CardUnavailableError('invalid-model');
  let remaining = maxRows;
  let omitted = false;
  const sections = [];
  for (const section of (Array.isArray(model.sections) ? model.sections.slice(0, 10) : [])) {
    if (!section || typeof section !== 'object') continue;
    const input = Array.isArray(section.rows) ? section.rows : [];
    const rows = [];
    for (const row of input.slice(0, remaining)) {
      if (!row || typeof row !== 'object') continue;
      const label = text(row.label, 180).trim();
      const value = text(row.value, label ? 500 : 900).trim();
      if (!label && !value) continue;
      const icon = typeof row.icon === 'string' && /^[a-z0-9][a-z0-9._-]{0,100}$/.test(row.icon) ? row.icon : '';
      rows.push({ label, value, icon });
    }
    if (input.length > rows.length) omitted = true;
    remaining -= rows.length;
    if (rows.length) sections.push({ title: text(section.title, 60).trim(), rows });
    if (!remaining) break;
  }
  const sourceSections = Array.isArray(model.sections) ? model.sections : [];
  if (sourceSections.length > sections.length && remaining === 0) omitted = true;
  const school = text(model.school, 20).toLowerCase();
  return {
    kind: text(model.kind, 20), title: text(model.title, 100).trim() || 'Wizard101 百科',
    subtitle: text(model.subtitle, 160).trim(), school: Object.hasOwn(SCHOOLS, school) ? school : 'universal',
    sections, footer: text(model.footer, 600).trim(), omitted,
  };
}

function within(root, file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}

function pngDimensions(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)
      || buffer.toString('ascii', 12, 16) !== 'IHDR' || buffer.readUInt32BE(8) !== 13) return null;
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height || width > 1024 || height > 1024 || width * height > 1024 * 1024) return null;
  return { width, height };
}

function cmapContains(buffer, offset, length, codepoint) {
  const end = offset + length;
  if (offset < 0 || end > buffer.length || length < 4) return false;
  const tables = buffer.readUInt16BE(offset + 2);
  if (tables > 64 || offset + 4 + tables * 8 > end) return false;
  for (let i = 0; i < tables; i++) {
    const record = offset + 4 + i * 8;
    const platform = buffer.readUInt16BE(record), encoding = buffer.readUInt16BE(record + 2);
    if (platform !== 0 && !(platform === 3 && [1, 10].includes(encoding))) continue;
    const sub = offset + buffer.readUInt32BE(record + 4);
    if (sub < offset || sub + 8 > end) continue;
    const format = buffer.readUInt16BE(sub);
    if (format === 12 && sub + 16 <= end) {
      const subEnd = sub + buffer.readUInt32BE(sub + 4), count = buffer.readUInt32BE(sub + 12);
      if (subEnd > end || count > 100000 || sub + 16 + count * 12 > subEnd) continue;
      for (let j = 0; j < count; j++) {
        const group = sub + 16 + j * 12;
        const first = buffer.readUInt32BE(group), last = buffer.readUInt32BE(group + 4);
        if (codepoint >= first && codepoint <= last && buffer.readUInt32BE(group + 8) + codepoint - first > 0) return true;
      }
    } else if (format === 4 && codepoint <= 0xffff) {
      const subEnd = sub + buffer.readUInt16BE(sub + 2), segments = buffer.readUInt16BE(sub + 6) / 2;
      if (!Number.isInteger(segments) || segments > 32768 || subEnd > end || sub + 16 + segments * 8 > subEnd) continue;
      const ends = sub + 14, starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let j = 0; j < segments; j++) {
        const start = buffer.readUInt16BE(starts + j * 2), finish = buffer.readUInt16BE(ends + j * 2);
        if (codepoint < start || codepoint > finish) continue;
        const delta = buffer.readInt16BE(deltas + j * 2), range = buffer.readUInt16BE(ranges + j * 2);
        if (!range && ((codepoint + delta) & 0xffff)) return true;
        const glyphAt = ranges + j * 2 + range + (codepoint - start) * 2;
        if (range && glyphAt + 2 <= subEnd && buffer.readUInt16BE(glyphAt) && ((buffer.readUInt16BE(glyphAt) + delta) & 0xffff)) return true;
      }
    }
  }
  return false;
}

function fontFamily(buffer, offset, length) {
  if (offset + length > buffer.length || length < 6) return '';
  const count = buffer.readUInt16BE(offset + 2), strings = offset + buffer.readUInt16BE(offset + 4);
  if (count > 2048 || offset + 6 + count * 12 > offset + length) return '';
  const names = [];
  for (let i = 0; i < count; i++) {
    const record = offset + 6 + i * 12;
    const platform = buffer.readUInt16BE(record), language = buffer.readUInt16BE(record + 4), id = buffer.readUInt16BE(record + 6);
    const size = buffer.readUInt16BE(record + 8), at = strings + buffer.readUInt16BE(record + 10);
    if (![1, 16].includes(id) || size > 256 || at + size > offset + length) continue;
    let name;
    if ([0, 3].includes(platform) && size % 2 === 0) name = Buffer.from(buffer.subarray(at, at + size)).swap16().toString('utf16le');
    else if (platform === 1) name = buffer.toString('latin1', at, at + size);
    else continue;
    names.push({ name: text(name, 100), score: (id === 16 ? 2 : 0) + (language === 0x409 ? 4 : 0) });
  }
  return names.sort((a, b) => b.score - a.score)[0]?.name || '';
}

function inspectFont(buffer) {
  if (buffer.length < 12) return null;
  let offsets = [0];
  if (buffer.toString('ascii', 0, 4) === 'ttcf') {
    const count = buffer.readUInt32BE(8);
    if (!count || count > 64 || 12 + count * 4 > buffer.length) return null;
    offsets = Array.from({ length: count }, (_, index) => buffer.readUInt32BE(12 + index * 4));
  }
  const candidates = [];
  for (const base of offsets) {
    if (base + 12 > buffer.length) continue;
    const count = buffer.readUInt16BE(base + 4);
    if (count > 256 || base + 12 + count * 16 > buffer.length) continue;
    const tables = {};
    for (let i = 0; i < count; i++) {
      const record = base + 12 + i * 16;
      tables[buffer.toString('ascii', record, record + 4)] = [buffer.readUInt32BE(record + 8), buffer.readUInt32BE(record + 12)];
    }
    if (!tables.cmap || !tables.name || !CJK_PROBE.every(cp => cmapContains(buffer, ...tables.cmap, cp))) continue;
    const family = fontFamily(buffer, ...tables.name);
    if (family) candidates.push(family);
  }
  return candidates.find(name => /(?: CJK SC| SC$|微软雅黑|Microsoft YaHei)/i.test(name)) || candidates[0] || null;
}

function defaultFonts() {
  const windows = process.env.WINDIR || 'C:\\Windows';
  return [
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
    '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
    '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
    path.join(windows, 'Fonts', 'msyh.ttc'), path.join(windows, 'Fonts', 'simsun.ttc'),
    path.join(windows, 'Fonts', 'msjh.ttc'), '/System/Library/Fonts/PingFang.ttc',
  ];
}

class CardRenderer {
  constructor(options = {}) {
    this.options = options;
    this.maxRows = Number.isInteger(options.maxRows) ? Math.max(4, Math.min(40, options.maxRows)) : 28;
    this.maxImageBytes = Number.isInteger(options.maxImageBytes) ? Math.max(32768, Math.min(4194304, options.maxImageBytes)) : 2097152;
    this.icons = new Map(); this.font = null; this.renderNative = null; this.ready = false; this.closed = false;
    this.iconIssue = null; this.problem = null; this.busy = false; this.cache = new Map();
  }

  async initialize() {
    if (this.closed) throw new CardUnavailableError('disposed');
    if (!this.initializing) this.initializing = this._initialize();
    await this.initializing;
    if (this.closed) throw new CardUnavailableError('disposed');
    return this.status();
  }

  async _initialize() {
    try { this.renderNative = require('@resvg/resvg-js').renderAsync; }
    catch { this.problem = 'renderer-unavailable'; }
    const candidates = this.options.fontPath ? [this.options.fontPath] : defaultFonts();
    for (const file of candidates) {
      try {
        if (typeof file !== 'string' || /^(?:https?|data|file):/i.test(file)) continue;
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > MAX_FONT_BYTES) continue;
        const data = await fs.readFile(file);
        if (data.length > MAX_FONT_BYTES) continue;
        const family = inspectFont(data);
        if (family) { this.font = { path: path.resolve(file), family }; break; }
      } catch { /* Try only the documented local font candidates. */ }
    }
    if (!this.font) this.problem = 'missing-cjk-font';
    if (this.options.iconPath) {
      try { await this._loadIcons(this.options.iconPath); }
      catch { this.icons.clear(); this.iconIssue = 'invalid-icon-catalog'; }
    }
    if (this.closed) { this.icons.clear(); this.font = null; return; }
    this.ready = true;
  }

  async _loadIcons(manifestPath) {
    if (typeof manifestPath !== 'string' || /^(?:https?|data|file):/i.test(manifestPath)) throw new Error('Local manifest required');
    const realManifest = await fs.realpath(manifestPath), root = path.dirname(realManifest);
    const meta = await fs.stat(realManifest);
    if (!meta.isFile() || meta.size > MAX_MANIFEST_BYTES) throw new Error('Manifest size');
    const raw = await fs.readFile(realManifest);
    if (raw.length > MAX_MANIFEST_BYTES) throw new Error('Manifest size');
    const manifest = JSON.parse(raw.toString('utf8'));
    if (manifest.schemaVersion !== 1 || !manifest.icons || typeof manifest.icons !== 'object' || Array.isArray(manifest.icons)) throw new Error('Manifest shape');
    const entries = Object.entries(manifest.icons);
    if (entries.length > 2048) throw new Error('Icon count');
    let bytes = 0;
    const loaded = new Map(), uris = new Map();
    for (const [key, entry] of entries) {
      if (!/^[a-z0-9][a-z0-9._-]{0,100}$/.test(key) || !entry || typeof entry !== 'object') throw new Error('Icon entry');
      const file = entry.file;
      if (typeof file !== 'string' || file.length > 240 || !/^[a-zA-Z0-9_./-]+\.png$/i.test(file)
          || file.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(file)) throw new Error('Icon path');
      const real = await fs.realpath(path.resolve(root, file));
      if (!within(root, real)) throw new Error('Icon escaped root');
      let data = loaded.get(real);
      if (!data) {
        const info = await fs.stat(real);
        if (!info.isFile() || info.size > MAX_ICON_BYTES) throw new Error('Icon size');
        data = await fs.readFile(real);
        if (data.length > MAX_ICON_BYTES || !pngDimensions(data)) throw new Error('Invalid PNG');
        bytes += data.length;
        if (bytes > MAX_ICON_TOTAL) throw new Error('Icon memory budget');
        loaded.set(real, data);
      }
      if (entry.sha256 && (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
          || crypto.createHash('sha256').update(data).digest('hex') !== entry.sha256)) throw new Error('Icon integrity');
      if (!uris.has(real)) uris.set(real, 'data:image/png;base64,' + data.toString('base64'));
      this.icons.set(key, uris.get(real));
    }
  }

  status() {
    return { ready: this.ready && !this.closed, fontAvailable: !!this.font && !this.closed,
      rendererAvailable: typeof this.renderNative === 'function' && !this.closed,
      fontFamily: this.font?.family || '', iconCount: this.icons.size,
      iconIssue: this.iconIssue, reason: this.closed ? 'disposed' : this.problem, cachedCards: this.cache.size };
  }

  async render(model) {
    await this.initialize();
    if (!this.font) throw new CardUnavailableError('missing-cjk-font', '缺少中文字体，请配置 fontPath 或安装 Noto Sans CJK 后生成图片卡片。');
    const normalized = normalizeModel(model, this.maxRows);
    const key = crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    if (this.cache.has(key)) return Buffer.from(this.cache.get(key));
    if (this.busy) throw new CardUnavailableError('busy');
    this.busy = true;
    try {
      if (typeof this.renderNative !== 'function') throw new CardUnavailableError('renderer-unavailable');
      const svg = createCardSvg(normalized, this.icons, this.font.family);
      const rendered = await this.renderNative(svg, {
        font: { loadSystemFonts: false, fontFiles: [this.font.path], defaultFontFamily: this.font.family,
          sansSerifFamily: this.font.family, serifFamily: this.font.family },
        languages: ['zh-CN', 'zh-TW', 'en'], fitTo: { mode: 'original' }, logLevel: 'off',
      });
      const png = Buffer.from(rendered.asPng());
      if (this.closed) throw new CardUnavailableError('disposed');
      if (png.length > this.maxImageBytes) throw new CardUnavailableError('image-too-large');
      // Small bound: at most four cards and 4 MiB retained per renderer.
      while (this.cache.size && (this.cache.size >= 4 || Array.from(this.cache.values()).reduce((sum, value) => sum + value.length, 0) + png.length > 4194304)) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(key, png);
      return Buffer.from(png);
    } catch (error) {
      if (error instanceof CardUnavailableError) throw error;
      throw new CardUnavailableError('render-failed');
    } finally { this.busy = false; }
  }

  async renderTextCard(value, options = {}) { return this.render(toCardModel(value, options)); }
  dispose() { this.closed = true; this.cache.clear(); this.icons.clear(); this.font = null; this.renderNative = null; }
}

function createCardSvg(model, icons = new Map(), family = 'sans-serif') {
  const [schoolLabel, accent] = SCHOOLS[model.school] || SCHOOLS.universal;
  const parts = [];
  const svgText = (value, x, y, size = 24, fill = '#eadfc9', extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;
  const iconAt = (key, x, y, size = 30) => {
    const uri = icons.get(key);
    return uri && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(uri)
      ? `<image x="${x}" y="${y}" width="${size}" height="${size}" href="${uri}"/>` : '';
  };
  const footerLines = wrapText(model.footer || '资料仅按来源展示 · 未提供的字段不推测', 797, 18, 12);
  const bodyEnd = Math.min(2250, 2470 - footerLines.length * 25 - 150);
  const differsAfterWrap = (original, lines) => original.replace(/\s/gu, '') !== lines.join('').replace(/\s/gu, '');
  let omitted = model.omitted;
  parts.push('<path d="M30 80H870M30 80L50 60M870 80L850 60" stroke="#796541" fill="none"/>');
  parts.push(svgText('WIZARD101  ·  中文图鉴', 48, 53, 18, '#bba47a', 'letter-spacing="2"'));
  parts.push(svgText(KIND_LABELS[model.kind] || '百科资料', 852, 53, 18, '#bba47a', 'text-anchor="end"'));
  const titleLines = wrapText(model.title, 715, 38, 2);
  if (differsAfterWrap(model.title, titleLines)) omitted = true;
  let y = 133;
  for (const line of titleLines) { parts.push(svgText(line, 48, y, 38, '#fff2d6', 'font-weight="600"')); y += 48; }
  parts.push(iconAt('school.' + model.school, 790, 103, 48));
  parts.push(svgText(schoolLabel, 814, 177, 19, accent, 'text-anchor="middle"'));
  if (model.subtitle) {
    for (const line of wrapText(model.subtitle, 790, 22, 2)) { parts.push(svgText(line, 50, y + 2, 22, '#aab8cb')); y += 31; }
  }
  y += 18;
  parts.push(`<path d="M48 ${y}H852" stroke="${accent}" stroke-opacity=".65"/>`);
  y += 31;
  sectionLoop: for (const section of model.sections) {
    if (y > bodyEnd - 100) { omitted = true; break; }
    if (section.title) { parts.push(svgText(section.title, 50, y, 20, '#d8bc81', 'letter-spacing="1"')); y += 19; }
    const sectionTop = y;
    const sectionParts = [];
    let reachedEnd = false;
    for (const row of section.rows) {
      const startX = row.icon && icons.has(row.icon) ? 104 : 67;
      const numbered = /^\d{1,3}$/u.test(row.label);
      const valueX = numbered ? startX + 47 : 339;
      const labelColumnLines = row.label ? wrapText(row.label, 204, 22, 20) : [];
      const stacked = labelColumnLines.length > 2;
      const labelLines = stacked ? wrapText(row.label, 834 - startX, 21, 7) : labelColumnLines;
      const valueLines = wrapText(row.value, row.label && !stacked ? 834 - valueX : 834 - startX, 24, 10);
      if (differsAfterWrap(row.value, valueLines) || differsAfterWrap(row.label, labelLines)) omitted = true;
      const height = stacked ? labelLines.length * 29 + valueLines.length * 33 + 32
        : Math.max(58, Math.max(valueLines.length, labelLines.length) * 33 + 24);
      if (y + height > bodyEnd) { omitted = true; reachedEnd = true; break; }
      sectionParts.push(iconAt(row.icon, 64, y + 16, 28));
      if (stacked) {
        labelLines.forEach((line, i) => sectionParts.push(svgText(line, startX, y + 32 + i * 29, 21, '#b5c2d2')));
        valueLines.forEach((line, i) => sectionParts.push(svgText(line, startX, y + 39 + labelLines.length * 29 + i * 33, 24, '#f1e6d2')));
      } else if (row.label) {
        labelLines.forEach((line, i) => sectionParts.push(svgText(line, startX, y + 38 + i * 33, 22, '#aab8c8')));
        valueLines.forEach((line, i) => sectionParts.push(svgText(line, valueX, y + 38 + i * 33, 24, '#f1e6d2')));
      } else valueLines.forEach((line, i) => sectionParts.push(svgText(line, startX, y + 38 + i * 33, 24, '#f1e6d2')));
      y += height;
      sectionParts.push(`<path d="M66 ${y}H834" stroke="#506175" stroke-opacity=".35"/>`);
    }
    if (y > sectionTop) {
      parts.push(`<rect x="48" y="${sectionTop}" width="804" height="${y - sectionTop}" rx="12" fill="#203148" stroke="#68717d" stroke-opacity=".32"/>`);
      parts.push(...sectionParts);
    }
    y += 35;
    if (reachedEnd || (omitted && y > bodyEnd - 50)) break sectionLoop;
  }
  if (!model.sections.length) { parts.push(svgText('暂无可显示的结构化资料', 64, y + 30, 24, '#aab8c8')); y += 85; }
  if (omitted) { parts.push(svgText('部分内容已省略，请查看文字结果或来源。', 50, y, 20, '#c7b690')); y += 31; }
  parts.push(`<path d="M48 ${y}H852" stroke="#796541"/>`); y += 32;
  for (const line of footerLines) { parts.push(svgText(line, 50, y, 18, '#a8b4c5')); y += 25; }
  const height = Math.min(2470, Math.max(430, y + 35));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}" viewBox="0 0 900 ${height}"><defs><linearGradient id="page" x2="0" y2="1"><stop stop-color="#14243a"/><stop offset="1" stop-color="#0c1727"/></linearGradient></defs><rect width="900" height="${height}" rx="22" fill="url(#page)"/><rect x="15" y="15" width="870" height="${height - 30}" rx="15" fill="none" stroke="#9b8350"/><rect x="23" y="23" width="854" height="${height - 46}" rx="11" fill="none" stroke="#443f35"/><g font-family="${escapeXml(family)}">${parts.join('')}</g></svg>`;
}

function toCardModel(value, options = {}) {
  const lines = text(value, 16000).split('\n').map(line => line.trim()).filter(Boolean);
  const title = options.title || lines.shift() || 'Wizard101 百科';
  const rows = lines.map(line => {
    const match = /^([^：:]{1,30})[：:]\s*(.*)$/u.exec(line);
    return match ? { label: match[1], value: match[2] } : { label: '', value: line };
  });
  return { kind: options.kind || 'dictionary', title, subtitle: options.subtitle || '', school: options.school || 'universal',
    sections: [{ title: options.sectionTitle || '查询结果', rows }], footer: options.footer || '' };
}

module.exports = { CardRenderer, CardUnavailableError, createCardSvg, normalizeModel, toCardModel,
  escapeXml, wrapText, inspectFont, pngDimensions, SCHOOLS };
