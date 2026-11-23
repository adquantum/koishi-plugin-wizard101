# 从自有 wizdb 数据库导入中文本地资料

`from-sqlite.py` 将部署者自己的 `items.db` 和可选 `decks.db` 转换为 Koishi 插件读取的 JSON / JSON.gz。需要 **Python ≥3.10**，仅使用 Python 标准库；不启动游戏、不运行 Discord Bot、不下载数据库，也不安装原上游机器人的运行时依赖。

0.3 的效果、属性、怪物汇总和展示语义适配自 [Kimerith-WindHammer `3c24847d111387fc0b34772b548f74e80089599f`](https://github.com/MajorPain1/Kimerith-WindHammer/tree/3c24847d111387fc0b34772b548f74e80089599f)，相关代码按 GPL-3.0-only 提供，原作者与修改说明见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。SQLite 字段依据 [wizdb schema](https://github.com/MajorPain1/wizdb/blob/main/wizdb/db.py)、[属性转换](https://github.com/MajorPain1/wizdb/blob/main/wizdb/stat_rules.py)和[记录导出](https://github.com/MajorPain1/wizdb)。公开仓库不附带游戏数据库或汉化全文。

## 推荐导入流程

先用[词典导入器](../locale/README.md)生成自己的中文词典，再运行：

```sh
python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --decks /path/to/decks.db \
  --locale /path/to/koishi-app/data/wizard101/locale-zh.json.gz \
  --version "自己确认的游戏或资料版本" \
  --output /path/to/koishi-app/data/wizard101/catalog.json.gz
```

Windows 可用已安装的 Python 启动器，路径含空格时加引号：

```powershell
py -3 tools/catalog/from-sqlite.py --input "D:\WizardData\items.db" --decks "D:\WizardData\decks.db" --locale "D:\Koishi\data\wizard101\locale-zh.json.gz" --version "自己的资料版本" --output "D:\Koishi\data\wizard101\catalog.json.gz"
```

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--input` | 是 | 已完成导出的 `items.db` 快照 |
| `--output` | 是 | 输出 `.json` 或 `.json.gz`，不能覆盖输入库 |
| `--decks` | 否 | 独立牌组库；用于上游规定的装备牌组整体回退 |
| `--locale` | 否 | 现有中文词典 JSON / JSON.gz；支持四元组或对象条目格式 |
| `--version` | 否 | 自己确认的游戏 / 资料版本，缺省“未标注” |
| `--types` | 否 | 逗号分隔的 `item,spell,mob,pet,fish,statcaps` 子集，默认全部 |

数据库通过 SQLite URI `mode=ro` 与 `query_only` 打开。输入不存在会报错，不创建空库。请提供导出已经完成且不再被其他进程修改的快照。输出通过临时文件检查后原子替换，失败时保留已有资料包。

Koishi 配置：

```yaml
plugins:
  wizard101:
    localePath: data/wizard101/locale-zh.json.gz
    catalogPath: data/wizard101/catalog.json.gz
    portraitPath: data/wizard101/portraits
```

路径相对于 Koishi 应用根目录，或使用绝对路径。导出摘要显示条数、类别和缺表提示。运行时不会再连接 SQLite；更新资料后重新运行导入并加载插件。

## 中文化策略

`--locale` 将英文原文与自己的汉化记录建立精确映射，做 Unicode / 大小写归一化。相同英文对应不同译文时不任意选一个；没有可靠映射时保留英文。当前命令行翻译器按**完整原文**匹配，不能承诺仅凭类似的描述或某个 locale ID 就自动翻译。

实体及引用名称可添加 `zh`，法术原始描述先尝试整段模板翻译，再展开参数和图标占位符。学派、目标、状态、条件结构、装备标记和属性标签已有中文实现，不要求大模型翻译。原始说明和未识别字段仍保留，以便核对。

运行时 `localePath` 仍负责中文名称检索、简繁和别名。更换词典后，如果希望重新生成描述或资料内引用译名，应同时重跑带 `--locale` 的数据库导入。

## 各类别导入范围

| 类别 | 内容 |
| --- | --- |
| `item` 装备 | 完整 ID、Object、等级、学派 / 编织限制、部位、稀有度、套装、插槽形状 / 锁定、自带卡、Maycast、起手豆、牌组容量、属性与原始标记 |
| `spell` 法术 | 模板 ID、学派 / 类别、命中、豆数 / X 豆 / 学派豆 / 暗影豆、能量、等级、用途标记、中文描述、效果树及目标数变体 |
| `mob` 怪物 | 名称、学派、阶级、生命、难度、AI、机制标记、怪物学采集、本体和全部关联装备属性、合并牌组 |
| `pet` 宠物 | 蛋、五维、Wow、专属、稀有度、套装、自带卡、普通 / 竞速天赋及 priority |
| `fish` 鱼类 | 学派、阶级、基础长度、尺寸倍率、最小 / 最大长度、速度、咬钩秒数和概率原值、哨兵标记 |
| `statcaps` 上限 | 等级 / 学派、生命 / 法力 / 魔豆等通用字段和七系命中、穿透、暴击、格挡、伤害、豆转换、抗性及单位 |

`locale_en` 和被引用的实体名称是必要数据。某主要类别表缺失时相应类别为空并在摘要说明；已存在表缺少必要列、关键名称引用无效、重复类型与 ID 或非法数值时中止，不伪造记录。法术效果表缺失另有兼容处理，见下节。

怪物 `has_cheats` 只是数据库标记，不等于 Boss 机制攻略。装备属性也不自动包含套装触发、穿戴条件、角色面板曲线或运行时增益。

## 法术说明与完整已知效果

`spell_effects.py` 是可复用的标准库模块。导入器复用一个 `SpellEffectRenderer`，一次预载 `effects` / `spell_effects` 后逐法术生成结果，避免对无索引表按法术反复全表扫描。

### 覆盖与目标数

- 枚举范围为 **152 个效果类型**；其中上游有专门说明的 **119 个类型 / 112 组主分支**均已移植。其余 33 个枚举以及枚举外数值保留类型名 / 原值并标为未解释。
- 处理 8 种效果类、21 类目标，包括普通递归、RandomSpell、X 豆变量、条件、目标数包装、挂饰转换与暗影契约；保留层级、回合数、治疗修正、保护、学派和相关状态。
- 包含彩色学派合并、转换、随机、伤害 / 治疗 / 持续效果以及上游占位符展开。仅有实际不同的六个元素学派才合并为彩色，施法者与目标上下文分别处理。
- 默认预编译 `num_targets=0、1、2、3、4`，加上数据库中出现的其他目标数。每个正常变体含通用行及对应目标数行；`0` 变体只含通用行。
- 运行时 `--targets` 允许 0–10000；找不到特定变体时只用 `0` 变体，保持原查询对未出现目标数只取通用行的语义。

这表示上游处理分支得到移植，并不表示所有游戏版本中的效果均有可证明解释。原版固定 `eAMul=50` 等假设会提示；未识别条件、缺引用、循环或孤立节点也会明确报告，不填造中文结论。

### 输出字段

| 字段 | 用途 |
| --- | --- |
| `description_raw` | 原始说明模板 |
| `description_parsed` | 展开参数后的原说明 |
| `description_zh` | 使用可用译文展开后的说明；不保证每段都存在对应中文原文 |
| `effect_variants` | `num_targets`、`text`、`effect_count` 的列表 |
| `effect_unparsed` | 未解释效果的 ID、类型、原因及 17 个原始字段 |
| `effect_warnings` | 未识别条件、兼容假设、缺表 / 引用等说明 |
| `spell_effects_available` | 所需效果表是否可用 |

缺 `effects` 或 `spell_effects` 时保留原始 / 可解析说明并返回明确提示，不使旧夹具或局部数据库整体崩溃。未解释效果保留原字段；默认不将全部 `effect_rows` 复制到每条 catalog，避免重复存储。

供二次开发的接口：

```python
from spell_effects import SpellEffectRenderer

renderer = SpellEffectRenderer(readonly_connection, translate=translate)
renderer.preload_effects()
entry.update(renderer.render_spell_details(spell_row))
# 调试可指定 include_raw=True；普通 catalog 不需要。
```

也有便利函数 `render_spell_details(connection, spell_or_template_id, num_targets=None, translate=None, include_raw=False)`。翻译回调接受 `(original, ref=None)`；无需 Discord、aiosqlite 或网络。效果关联使用法术 **template_id**，不能误换成 SQLite 自增行号。

## 135 个属性映射与单位

`combat.py` 保留参考提交完整的 **135 个 Canonical 哈希**、排序和中文显示标签。装备完整展示使用 `native_stats`；原有 `stats` / `stat_units` 结构继续提供常见字段，二者用途不同。

对 `kind=1`，`a` 为属性哈希，`b` 已经是 wizdb 完成转换 / round 后的数值。**不能把 `b` 再当浮点位串解包，也不能把百分比再乘 100。** 未识别哈希保留 `hash/value` 与未知标记；不是丢掉后称为“完整属性”。

| 属性例 | 单位与处理 |
| --- | --- |
| `Damage/ReduceDamage/Accuracy/ArmorPiercing` | percent：伤害、抗性、命中、穿透 |
| `FlatDamage/FlatReduceDamage` | flat：固定增伤 / 减伤 |
| `CriticalHit/Block/PipConversion` | rating：暴击、格挡、魔豆转换 |
| `*Rating` 中单位未经确认的导出字段 | exported_rating：保留原值，展示时注明 |
| `MaxHealth/MaxMana/MaxEnergy` | flat：生命、法力、能量 |
| 精通、免疫、法力上限降低等文本标记 | flag / 文本展示，同时保留原数值 |

普通 `stats` 中同路径的原始加成会求和，并保留 `stat_record_counts` / notes。该行为不等于完整怪物参考合并，也不自动计算套装或最终角色面板。

`parsed_stats` / `unparsed_stats` 统计的是旧简化 `stats` 结构的解析情况，不是 135 映射的覆盖统计。某条记录在旧结构中计为未解析，仍可能已在 `native_stats` 中有完整映射；检查完整展示应以原生属性记录及其中的 `known` 标记为准。

其他原始记录依 `kind` 解析：2 为起手普通豆 / 超级豆；3 为自带卡与数量；4 为 Maycast 法术和描述引用；5 为速度原值；6 为座位原值。重复速度 / 座位记录保留数组，不猜叠加或有效座位数。卡片引用未解析时保留完整模板 ID 和提示。

## 怪物本体与全部装备汇总

`build_mob_combat()` 读取 `mob_stats`，遍历 `mob_items` 的全部装备关联，再读取每件装备的 `item_stats`。多只怪物共用的装备属性会缓存；没有静默只取第一件装备。重复关联按上游逐次合并并提示。

完整结果存于 `entry.combat`：

| 字段 | 含义 |
| --- | --- |
| `revision` | 固定参考提交 |
| `stats_scope` | `base_and_equipment` |
| `complete` | 本次固定算法所需的本体、关联表、引用和装备属性是否完整读到 |
| `equipment_ids` | 实际遍历的装备 ID |
| `raw_stats` | 上游合并顺序得到的原始属性 |
| `display_stats` | 详情展示值，包含上游 polymorph 显示处理 |
| `target_by_school` | 各攻击学派的通用 + 分学派抗性 / 格挡 |
| `warnings` | 缺资料、重复属性、评级与兼容行为说明 |

顶层 `entry.stats` 仍是旧结构的本体值，因此顶层 `stats_scope` **保留 `base_only`**。不能看到这个兼容字段就忽略新的 `combat`，也不能把旧本体字典伪装成装备汇总。新 `wiz.mob.find` 展示 `combat.display_stats`；新 `wiz.mob.calc` 只消费参考版本匹配且 `combat.complete=true` 的目标资料。旧 `wiz.mobcalc` 对完整新资料引导到新命令，对旧 `base_only` 拒绝计算。

缺少关联表时，工具无法据此判断“怪物没有装备”，会标记不完整；有完整空关联表则按该快照的零件装备处理。`complete=true` 不证明当前游戏服务器版本无遗漏，未知属性也可能仍需进一步解释。

为复刻固定上游，还保留并提示重复同 `order` 本体记录的非普通求和行为、`ReduceDamageRating` 计入抗性的语义，以及 `polymorph` 怪物“展示减半、计算不减半”的差异。详见[功能对照](../../docs/reference-parity.md#检索和计算行为)。

### 牌组优先级

先按所有关联装备内部名取 `items.db` 的牌组。**整组为空**才回退到 `--decks` 中这些装备的牌组；最后追加 `items.db` 中怪物自己的牌组。不是逐装备补齐，也不把两个库中的所有结果无条件拼接。法术名称解析失败时保留引用。

## 宠物、鱼类与上限

普通 / 竞速天赋遵循上游布局：`talents` 按原始 ID 顺序读取，前 10 行放普通天赋，其余为竞速天赋，两组各自按 `priority` 排序。输出 `talents`、`derby_talents` 和 `talent_layout`。这是明确的兼容约定，表本身没有保证适用于任意数据版本的分类字段。

鱼类 `min_size/max_size` 是基础长度倍率，原字段继续保存；同时输出 `min_length/max_length = round(base_length × 对应倍率, 2)`。咬钩机会保持原值，不猜其是 0–1 还是百分数；`bite_seconds` 按秒标注。

属性上限保留各数值的单位。新 `wiz.statcaps.find 等级 学派` 先向下取十级档位，仅查 10–190；旧 `wiz.statcaps 学派 等级` 仍按精确等级查。资料缺档位时不插值或推算。

## 原版画像与缩略图

原图与 `Icons.zip` 小图标是两类资源。导入器从实体 `image_file` 或 `image` 中取最后一个 `|` 分段和路径文件名，截取首个 `.` 前的名称、去掉空格，再加 `.png`；结果保存到 `portrait`。例如 `GUI/Portraits/Example Image.dds` 对应 `ExampleImage.png`，此处只是合成命名例。

将自己有权使用、已转换好的 PNG 直接放在 `portraitPath` 目录。可以指向自己现有的 `PNG_Images` 目录，或默认 `data/wizard101/portraits`。导入器不会附带、下载或自动转换这些画像。

读取器只接受目录内的单个 PNG 文件名，不接受 URL、路径穿越或指向目录外的符号链接。单图最多 2 MiB，宽高各最多 2048，像素数最多 4,194,304。文件缺失或无效时略过画像，文字和其他资料正常显示。

## ID、标记和字段保留

所有实体 ID 输出为完整十进制字符串，避免 JavaScript 精度丢失。法术 `id` 使用 `spells.template_id`，数据库自增 ID 单独保存为 `row_id`。`pet_cards.spell` 可按内部 Object 名字节串解析，也兼容可确认的模板 ID。

`statcaps` 没有游戏实体 ID，采用 `9000000000 + 学派编码 × 100000 + 等级` 的稳定本地 ID，并设置 `local_only: true` / `id_scope: local-statcaps`；不能把它发送给 Wizard404。

装备学派高位排除限制、次学派编织要求、类别位、限制标志、宝石孔和稀有度等同时保留可读标签和必要原值。未知位 / 编码明确显示，不猜唯一部位或正常学派。当前主学派术语与用户汉化一致使用冰霜、神圣、亡灵；寒冰、神话、死亡等旧检索别名继续接受。

## 大资料包与资源限制

只导出所需类别可减少文件和运行时内存：

```sh
python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --locale /path/to/locale-zh.json.gz \
  --types pet,fish,statcaps \
  --output /path/to/catalog.json.gz
```

关联必需的法术或装备名称仍会读取，但不作为未选类别加入输出。当前运行时只加载一个 `catalogPath`；分类型导出后需要选择实际部署的资料包，不会自动合并多个输出文件。

| 限制 | 0.3 上限 |
| --- | --- |
| 输出实体 | 100,000 条 |
| JSON 解压后大小 | 256 MiB，导入器与 JS 读取器一致 |
| 单字符串字段 | 1,048,576 个 UTF-16 单元 |
| 单实体节点 / 嵌套 | 131,072 个节点 / 10 层 |
| 普通字段数组 | 512 项 |
| `effect_unparsed` / 调试 `effect_rows` | 4,096 项 |
| `effect_warnings` | 8,192 项 |
| 单法术原始效果 / 递归深度 | 4,096 条 / 64 层 |
| 单法术目标数变体 | 128 个 |
| 主要实体表 / 英文文本表 | 每表 100,000 行 / locale_en 1,000,000 行 |

效果预载另有总行数和条件文本预算。超过边界明确报错，不静默裁掉效果、未知字段或说明。256 MiB 是序列化 / 解压文本上限，不等于进程只占 256 MiB；对象、索引和渲染缓存会占额外内存。

详情显示取消旧的固定字段 / 数组截断，资料按页可达；完整回复最多 100,000 页，超限显式报错。正常 catalog 不导出所有原始效果行，只保留解析文本、必要未知原值和提示。

## 验证与版本边界

```sh
node --test test/catalog-import.test.cjs test/spell-effects.test.cjs test/kimerith-math.test.cjs test/kimerith.test.cjs
```

这些测试使用临时合成 SQLite，验证只读输入、ID 精度、缺表 / 缺列、关联优先级、效果枚举 / 类别 / 目标 / 模板、条件递归、未知原值、600 条未解释效果和长说明的尾部可达、135 属性、全部装备合并、宠物分组、鱼长度和参考计算。可通过 `WIZARD101_TEST_PYTHON` 指定测试 Python 可执行文件。

本项目没有附带或全量验证真实私有 `items.db`。wizdb 或游戏版本变化可能需要新的字段适配；成功导入与测试不能代替自己资料版本的抽样核对。0.2 的词典、图标和原 catalog schema 仍可读，但新增字段需要使用 0.3 工具重新导出。

原始 `.db`、生成的完整 catalog、中文词典及画像放在部署数据目录，不提交到公开仓库或安装包。源代码许可证不重新授予游戏数据或译文的使用权。
