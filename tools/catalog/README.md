# 从自有 wizdb 数据库导入本地资料

`from-sqlite.py` 将部署者自己的 `items.db` 转换成插件可读取的本地资料包。使用 Python 3 标准库，无需安装 Python 依赖。它读取数据库，不会启动游戏、运行第三方机器人或下载游戏数据。

字段依据为 [wizdb 的公开 SQLite schema 与记录转换](https://github.com/MajorPain1/wizdb/blob/main/wizdb/db.py)、[属性导出规则](https://github.com/MajorPain1/wizdb/blob/main/wizdb/stat_rules.py)、[物品类别位标记](https://github.com/MajorPain1/wizdb/blob/main/wizdb/item.py)与[学派枚举及哈希约定](https://github.com/MajorPain1/wizdb/blob/main/wizdb/utils.py)。实现独立编写，未移植 Kimerith-WindHammer 的 Bot 源码。公开仓库不附带数据库或游戏文本。

## 快速开始

Linux/macOS 在插件源码目录运行：

```bash
python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --output /absolute/path/to/koishi-app/data/wizard101/catalog.json.gz
```

Windows 可使用已安装的 Python 3 启动器：

```powershell
py -3 tools/catalog/from-sqlite.py --input "D:\WizardData\items.db" --output "D:\Koishi\data\wizard101\catalog.json.gz"
```

路径含空格时加引号。数据库应是 `wizdb` 已完成生成、未被其他进程修改的快照。导入器通过 SQLite URI `mode=ro` 和 `query_only` 打开，输入文件不存在时直接报错，不会创建空数据库；输出路径不能覆盖输入数据库。

如有单独的牌组数据库，可增加参数：

```bash
python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --decks /path/to/decks.db \
  --version "自己确认的游戏或资料版本" \
  --output /absolute/path/to/koishi-app/data/wizard101/catalog.json.gz
```

`--version` 由部署者填写，未提供时写入“未标注”；工具不会把当前日期当成游戏版本。`--decks` 通过怪物及装备内部名称关联牌组，遇到同名数据优先使用 `items.db` 中的记录。

然后在 Koishi 的插件配置中设置：

```yaml
plugins:
  wizard101:
    catalogPath: data/wizard101/catalog.json.gz
```

该路径相对于 Koishi 应用根目录，也可以使用绝对路径。中文名称解析仍由 `localePath` 对应的本地化词典提供，参见[本地化导入工具](../locale/README.md)。

## 导入范围

| 类别 | 本版导入内容 | 保留的限制 |
|---|---|---|
| 物品 `item` | 名称、内部名、模板 ID、等级、装备学派限制、类别位标记、套装名称、宝石孔原值、牌组容量、常见属性、自带卡、Maycast、起手豆、速度原值、座位数 | 未识别哈希或种类记录 `unparsed_stats`；不模拟角色面板、套装触发与装备条件 |
| 法术 `spell` | 模板 ID、名称、学派、基础类型、豆数、命中、能量、等级、描述模板 | 不展开底层效果树；PvE/PvP 标记保留为原始字段，不推断可用场景 |
| 怪物 `mob` | 名称、学派、生命、等级、类别、AI 参数、原始标记、常见本体属性、可关联的牌组 | `stats_scope: base_only` 表示未汇总装备，不能当成完整抗性；是否作弊的标记不是机制攻略 |
| 宠物 `pet` | 蛋名、五维、Wow、专属标记、套装名称、天赋名称及 priority、自带卡关联 | `talents` 表没有普通/竞速类别列，按行 ID 保留顺序，不凭位置猜类别 |
| 鱼类 `fish` | 学派、等级、基础长度、尺寸倍率、速度、咬钩参数、哨兵标记 | `min_size/max_size` 是基础长度倍率；概率参数保留原始值，不擅自转换单位 |
| 属性上限 `statcaps` | 等级、学派、生命/法力/豆等通用字段，以及七系命中、穿透、暴击、格挡、伤害、豆转换、抗性 | 每个分学派数值明确 `percent` 或 `rating`；不能将 rating 直接用作伤害估算百分比 |

数据库缺少某种数据表时，相应类别为空，导入摘要会列出缺表；已存在的表缺少关键列时直接报告表名和列名。空表是有效输入，不会生成虚构条目。英文名称关联缺失、重复类型与 ID 或非法数值会中止导入，保持原有输出文件不变。

### 装备属性与单位

对 `item_stats` 和 `mob_stats` 的 `kind=1`，导入器独立实现 FNV-1a 64 位哈希及 wizdb 的右移一位规则，将 `a` 与已知 Canonical 标识对应。**`b` 已经是 wizdb 完成换算并 `round()` 的整数值，不是打包的浮点位串。** 已转换的百分比直接读取，不再次乘 100。

支持 `All/Fire/Ice/Storm/Myth/Life/Death/Balance/Shadow` 的常见属性。`All` 输出到 `stats.universal`，其余输出到相应英文小写学派，例如：

```json
{
  "stats": {
    "health": 350,
    "fire": { "damage_percent": 30, "critical_rating": 420 },
    "universal": { "resist_percent": 10 }
  },
  "stat_units": {
    "health": "flat",
    "fire.damage_percent": "percent",
    "fire.critical_rating": "rating",
    "universal.resist_percent": "percent"
  }
}
```

上面的数值只是合成格式示例，不对应真实装备。

| Canonical 属性后缀 | 输出字段 | 单位 |
|---|---|---|
| `Damage` / `ReduceDamage` | `damage_percent` / `resist_percent` | percent |
| `Accuracy` / `ArmorPiercing` | `accuracy_percent` / `pierce_percent` | percent |
| `FlatDamage` / `FlatReduceDamage` | `flat_damage` / `flat_resist` | flat |
| `CriticalHit` / `Block` | `critical_rating` / `block_rating` | rating |
| `PipConversion` | `pip_conversion` | rating |
| `DamageRating` / `ReduceDamageRating` / `AccuracyRating` / `ArmorPiercingRating` | `damage_rating` / `resist_rating` / `accuracy_rating` / `pierce_rating` | exported_rating，保留导出值，不视作百分比 |

通用的 `CanonicalMaxHealth/MaxMana/MaxEnergy` 导入 `stats.health/mana/energy`；`CanonicalPowerPip` 导入 `power_pip_percent`；`CanonicalIncHealing/LifeHealing` 导入 `incoming_percent/outgoing_percent`；`CanonicalShadowPipRating/AllArchmastery` 导入 `shadow_rating/archmastery_rating`。`CanonicalAllPowerPipRating` 单独保留为 `power_pip_rating`，单位标记为 `exported_rating`，不会冒充已计算好的超级豆概率。

同一路径出现多条数值记录时，导入器求取这些**原始加成的和**，并通过 `stat_record_counts`、`notes` 明确记录合并。它没有计算装备条件、套装激活、角色面板软上限或游戏运行时规则。单件装备的属性不能直接视作整个人物的最终面板；怪物本体属性也不能直接视作本体加装备后的完整抗性。

其他记录种类按 `db.py` 的 `convert_stat` 契约读取：

| kind | 输出 | 处理方式 |
|---|---|---|
| 2 | `stats.pips`、`stats.power_pips` | 起手普通豆、超级豆，单位 count |
| 3 | `cards` | `a` 是法术模板 ID，`b` 是数量；关联法术名称和内部名 |
| 4 | `maycasts` | `a` 是法术模板 ID，`b` 是描述文本 ID；分别解析卡片与描述，保留完整 ID |
| 5 | `speed_multiplier` | 原始 `m_speedMultiplier`；多条时保留 `speed_multipliers`，不推断叠加或换算百分比 |
| 6 | `passengers` | 原始座位数；多条时保留 `passenger_counts`，不推断有效总数 |

`parsed_stats` / `unparsed_stats` 表示已识别/未识别的原始记录条数，不是独立属性数量。未知哈希继续计入 `unparsed_stats`，不会静默丢失后宣称属性完整。法术引用找不到名字时保留模板 ID 并标记 `unresolved`。

### 完整 ID 与本地 ID

- 所有实体 ID 都输出为完整十进制字符串，避免 JavaScript 大整数精度损失。
- 法术使用 `spells.template_id` 作为 `id`，SQLite 自增行号单独保存为 `row_id`，不会把行号发送成法术 ID。
- `pet_cards.spell` 在公开 DDL 中写作 integer，但导出器实际可能写入 Object 名字节串；导入器先按内部名解析，也兼容能对应模板 ID 的记录。
- `statcaps` 没有游戏条目 ID。本工具生成 `9000000000 + 学派编码 × 100000 + 等级` 作为稳定本地 ID，并标记 `local_only: true`、`id_scope: local-statcaps`。**此 ID 仅用于本地索引，不能发送给 Wizard404 API。**
- 装备学派的高位排除限制与未知编码保存为 `school_raw`，学派显示 `unknown`，不会误判成普通学派。
- 装备类别按公开 `ITEM_ADJECTIVES` 的位序解释。多类别、未知位或空位会保留 `kind_raw` 与可识别的 `kinds`，不猜测唯一装备槽位。

## 控制资料包大小

默认尝试导出 `item,spell,mob,pet,fish,statcaps`。可以只导出需要的类别：

```bash
python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --types pet,fish,statcaps \
  --output /absolute/path/to/koishi-app/data/wizard101/catalog.json.gz
```

这仍会读取宠物自带卡所需的法术名称关联，但不会把所有法术条目加入输出。

限制与插件读取器保持一致：最多 100,000 个输出条目、解压后 64 MiB、单字段数组 512 项、单条数据最多 4,096 个节点和 10 层嵌套。超过限制会报错，避免悄悄截断资料。每张主要实体表另外设有 100,000 行读取上限，英文文本表上限为 1,000,000 行。

输出支持 `.json` 和 `.json.gz`。使用临时文件完成序列化和检查后原子替换目标文件；失败时不留下半个资料包。

## 验证与数据边界

自动化测试使用临时创建的合成 SQLite 数据库，覆盖大整数 ID、表关联、只读连接、输入哈希不变、空表、缺列诊断、牌组来源优先级、分类型导出、常见属性与明确单位、重复属性求和、未知属性保留、自带卡/Maycast、大整数描述引用、重复速度/座位记录，以及重复 ID 和数组/数值边界。

```bash
node --test test/catalog-import.test.cjs
```

测试需要可执行的 Python 3；可用 `WIZARD101_TEST_PYTHON` 指定测试运行器使用的 Python 可执行文件。当前没有附带或验证任何真实私有 `items.db`，不同版本的 wizdb schema 可能需要进一步适配。对未解析字段，工具会在条目 `notes` 中注明，不把缺失值补成游戏属性的零值。

自行准备有权使用的数据库。原始 `.db`、生成的完整 `catalog.json(.gz)` 和游戏文本应放在部署数据目录，不提交到公开仓库或 npm 包。
