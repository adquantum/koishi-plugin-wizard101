# 本地化词典导入

这个工具只读取 `.wad` / `.lang`，不改写原包，不导出字体或贴图。运行环境为 Node.js 18 或更高版本，不依赖 npm 第三方解析库。

## 使用

```bash
node tools/locale/import.cjs --input /path/to/Locale_en-US-Root.wad --output data/locale-zh.json.gz
node tools/locale/import.cjs --input /path/to/Spells.lang --output data/spells.json
node tools/locale/import.cjs --input /path/to/Locale/en-US --output data/locale-zh.json.gz
```

Windows 路径含空格时加双引号。目录输入会递归读取 `.lang` 文件，拒绝符号链接。输出必须是 `.json` 或 `.json.gz`；后者适合随插件部署。

导入器支持 `KIWAD` v1 和 v2。v1 目录结构为：5 字节 magic、32 位小端版本、32 位小端文件数，再按文件记录偏移、原始长度、压缩长度、压缩标志、校验字段和带 NUL 结尾的文件名。v2 多一个头部字节；v1 曾使用实际输入验证，v2 目前通过合成夹具测试。压缩成员使用 zlib。文件边界、文件名、总大小、单文件大小、解压长度、文本编码和记录三元组都会检查。

`.lang` 是 UTF-16LE：可带 BOM，首行 `1:表名`，随后每 3 行是 `key`、原文、译文。**空行也属于数据**，不能先删空行。空原文不应猜成英文，空译文不应自动补全。

部分修改后的归档可能出现存储校验字段与解压后标准 CRC32 不符的情况。工具默认记录不匹配数量，仍严格检查长度、解压和编码；传入 `--strict-crc` 会拒绝校验不匹配的成员。不要仅凭该字段差异推断译文损坏。

## 输出格式

```js
const fs = require('node:fs');
const zlib = require('node:zlib');
const dictionary = JSON.parse(
  zlib.gunzipSync(fs.readFileSync('data/locale-zh.json.gz'), {
    maxOutputLength: 64 * 1024 * 1024,
  }).toString('utf8'),
);
// dictionary.schemaVersion === 1
// dictionary.files[i] = { path, table, records }
// dictionary.entries[n] = [fileIndex, key, original, localized]
// dictionary.stats gives record counts, not unique wiki entity counts.
```

路径统一使用 `/`，保留原始大小写和 `.lang` 后缀；key 保留前导零和空格。原文、译文保留游戏标记和 `\\n` 等转义文本。渲染聊天消息时应转成安全的纯文本，不能把词条直接解释成 HTML 或 Koishi 消息元素。

**索引时保留数组**：相同 `(文件路径, key)` 也可能出现多次，`(表名, key)` 重复更多。一个英文名称可能有多个译名，同一中文词也可能对应多个英文名称。不要使用简单 `Object.fromEntries()` 覆盖前面的记录。可以另外建立归一化查询字段，原始字段用于来源和核对。

建议匹配顺序：完整文件引用 → 对应类别的精确中英文名称 → 全局精确名称候选 → 有限的包含检索。不同表可能复用 key 或名称；不能脱离文件和类别上下文选择译名。

## 数据能力边界

本地化文件提供名称、描述、任务标题、对话和界面文本。它们不等于可直接用作百科实体的数据库；例如有名称并不意味着掌握装备属性、怪物掉落率或 Boss 作弊规则。双语匹配记录数也不等于 API 覆盖率。

公开仓库不附带原始 WAD、完整汉化词典、字体或贴图。部署者导入自己有权使用的数据；导入器保留原文和来源，译名质量与游戏版本仍需自行核对。

## 验证

```bash
node --test test/locale.test.cjs
```

测试包含 UTF-16LE / BOM / 空值处理、压缩与非压缩 WAD、路径遍历、越界文件、目录重叠、解压预算、重复名称、多译、递归导入和 CLI gzip 输出。
