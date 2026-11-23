# 配置与使用手册

本文对应 **0.3.1**。默认命令前缀为 `wiz`，可在 `command` 中修改。新增的 Kimerith 兼容路由、旧百科 / 词典入口、平台交互使用同一份本地词典和资料包。

本项目提供源码，尚未发布 npm 包或 Koishi 插件市场条目。从源码安装的方法见[首页](../README.md#快速开始)。环境要求为 Node.js ≥22、Koishi `^4.18.11`；一次性数据库导入使用 Python ≥3.10，转换自定义图标另需 Pillow；内置图标可直接使用。机器人正常运行不需要 Python。

## 准备自己的数据

| 资源 | 提供什么 | 默认位置 |
| --- | --- | --- |
| 中英词典 | 汉化名称、描述、界面 / 对话文本，文件与 key 引用 | `data/wizard101/locale-zh.json.gz` |
| 游戏资料包 | 装备数值、法术效果、怪物装备 / 牌组、宠物、鱼类、属性上限 | `data/wizard101/catalog.json.gz` |
| 小图标 | 随包的 323 个原版 PNG 与语义清单 | 插件内 `assets/icons/manifest.json`；兼容已有自定义数据目录 |
| 中文字体 | PNG 中文文字 | 自动发现，或 `fontPath` 指定 |
| 原版画像 | 法术 / 怪物等可选 PNG 缩略图 | `data/wizard101/portraits` |

这些数据互不替代。只有汉化文本时，可进行中英词典查询；数值图鉴和 `mob.calc` 还需要游戏资料库。公开源码及安装包包含默认小图标，不包含完整游戏数据库、完整汉化词典、画像或字体。

```sh
node tools/locale/import.cjs \
  --input /path/to/Locale_en-US-Root.wad \
  --output /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz

python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --decks /path/to/decks.db \
  --locale /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz \
  --version "自己确认的游戏或资料版本" \
  --output /absolute/path/to/koishi-app/data/wizard101/catalog.json.gz

```

默认小图标已经安装到插件包中，不需要执行图标转换。要使用自己的图标版本，可参照[图标导入工具](../tools/icons/README.md)生成清单。

`--decks` 和 `--locale` 可省略。推荐提供中文词典，使名称和法术原始说明在导入时得到可靠翻译；没有唯一译文时保留原文。即使省略词典，效果层级、目标、状态和条件结构也有中文解释。`--version` 不填时标为“未标注”，不会把导入日期当作游戏版本。

LANG 输入使用 UTF-16LE；空行可能属于字段，不应预先删空行。原始数据只读，导入工具不下载数据库或游戏资源。详见[词典导入](../tools/locale/README.md)、[数据库导入](../tools/catalog/README.md)、[图标导入](../tools/icons/README.md)。

## 基础配置

用户填写的相对路径以 **Koishi 应用根目录**为准，也可写绝对路径。`localePath/catalogPath/portraitPath` 留空采用上表默认位置。`iconPath` 留空时，已有且有效的 `data/wizard101/icons/manifest.json` 优先；旧清单缺失或损坏则使用插件包内 `assets/icons/manifest.json`，损坏时保留状态提示。填写 `iconPath` 可选用独立自定义清单，加载失败时保留文字标签并报告错误。内置资源按插件安装位置定位，不要求把图片复制进 Koishi 工作目录。`fontPath` 留空自动发现 Noto CJK、微软雅黑等中文字体。

```yaml
plugins:
  wizard101:
    command: wiz
    defaultType: item
    enableChineseAliases: true
    localePath: data/wizard101/locale-zh.json.gz
    catalogPath: data/wizard101/catalog.json.gz
    dataSource: hybrid
    replyMode: auto
    iconPath: '' # 默认内置图标；已有 data/wizard101/icons 时优先使用
    fontPath: ''
    portraitPath: data/wizard101/portraits
    nativeDiscordEnabled: false
    discordCommandName: ''
    discordGuildId: ''
    qqInputButtons: false
    apiKey: ''
    userAgent: ''
    authMode: bearer
    onlineSearchEnabled: false
```

完整示例见 [examples/koishi.yml](../examples/koishi.yml)。改变数据文件后重新加载插件，查看 `wiz.status` 的加载结果；该命令要求 Koishi 权限等级 3，不回传密钥。

### 查询来源

**新 15 路由中的图鉴查询固定读取本地资料。** `wiz.item.find/list`、`spell`、`mob`、`pet`、`fish` 的对应新路由以及 `statcaps.find` 不向 API 猜测查询，也不受 `onlineSearchEnabled` 影响。`calc` 和 `help` 不需要资料库；`mob.calc` 必须有完整的本体 / 装备汇总。

`dataSource` 作用于原有 `wiz.search`、`wiz.item`、`wiz.spell`、`wiz.detail` 等入口：

| 模式 | 原有查询入口的行为 |
| --- | --- |
| `hybrid`（默认） | 按名查询优先本地已收录类别；缺少整个类别时进入 API 流程。该类别存在但没有命中时返回空结果。按 ID 先找本地该条目，找不到可请求 API |
| `local` | 只查本地，不进入 API |
| `api` | 常规百科类别走 API；宠物、鱼类和属性上限仍只能使用本地资料 |

旧 `wiz.list` 始终查本地。支持 `--remote` 的旧查询可显式进入 API，但不能覆盖 `local` 模式，也不适用于本地专用类别。`wiz.where` 的本地路径匹配区分大小写；在 `hybrid` 下没有区域类别时可进入 API 流程。

`onlineSearchEnabled` **只控制 API 按名搜索**。关闭时进入该流程会返回词典结果或提示；不妨碍本地查询或按 ID 请求。真正联网还需要有效 Key 和 User-Agent。

## 完整指令

### 15 条 Kimerith 兼容路由

文字命令中，`<名称:text>` 会读取余下整段文本，**所有选项放在名称前**。英文名可有空格。`list` 不填名称等同 `*`；Discord 原生 `list` 仍需填写 `name`，列出全部时填 `*`。

| 路由与文字指令 | 文字参数 / 选项 |
| --- | --- |
| `wiz.item.find 名称` | `-s school`、`-k kind`、`-l level`、`--search-by Name/Object/ID` |
| `wiz.item.list [关键词]` | `-s school`、`-k kind`、`-l level` |
| `wiz.spell.find 名称` | `-s school`、`-k kind`、`-r rank`、`--search-by`、`--effects true/false`、`--targets 整数` |
| `wiz.spell.list [关键词]` | `-s school`、`-k kind`、`-r rank` |
| `wiz.mob.find 名称` | `-s school`、`-k kind`、`-r rank`、`--search-by` |
| `wiz.mob.list [关键词]` | `-s school`、`-k kind`、`-r rank` |
| `wiz.mob.deck 名称` | `-s school`、`-k kind`、`-r rank`、`--search-by` |
| `wiz.mob.calc 名称` | 必填 `-s school`、`--base base`、`-d damage`、`-p pierce`、`-c critical`；可选 `--buffs`、`--pvp`、`--search-by` |
| `wiz.pet.find 名称` | `-s school`、`--wow 整数`、`--exclusive true/false`、`--search-by` |
| `wiz.pet.list [关键词]` | `-s school`、`--wow 整数`、`--exclusive true/false` |
| `wiz.fish.find 名称` | `-s school`、`-r rank`、`--sentinel true/false`、`--search-by` |
| `wiz.fish.list [关键词]` | `-s school`、`-r rank`、`--sentinel true/false`、`--object-names true/false` |
| `wiz.statcaps.find 等级 学派` | 两个位置参数；七大学派、十级档位 |
| `wiz.calc 基础伤害` | 必填 `-d damage`、`-p pierce`、`-c critical`、`-r resist`、`--block block`；可选 `--buffs`、`--pvp` |
| `wiz.help` | 无 |

上述选项名称的长形式对应 `--school/--kind/--level/--rank/--damage/--pierce/--critical/--resist`。Slash 参数沿用上游 snake_case；与文字指令不同的映射如下：

| Discord 参数 | 文字指令 |
| --- | --- |
| `name` | 最后的名称参数 |
| `search_by` | `--search-by` |
| `show_spell_effects` | `--effects` |
| `num_targets` | `--targets` |
| `is_sentinel` | `--sentinel` |
| `use_object_name` | `--object-names` |
| `base` | 通用计算的位置参数；怪物计算的 `--base` |

其他参数按同名对应。Discord 提供 `zh-CN` / `zh-TW` 的本地化名称，系统仍按英文标识传递参数。完整原生定义见[原生命令文档](native-interactions.md#完整参数)。

### 筛选值与匹配规则

| 参数 | 默认值及含义 |
| --- | --- |
| `school` | `Any`，不限；七大学派为 `fire/ice/storm/myth/life/death/balance` |
| `kind` | `Any`，不限；物品 `hat/robe/shoes/weapon/athame/amulet/ring/deck/jewel/mount`；怪物 `easy/normal/elite/boss` |
| 法术 `kind` | 上游公开选项为 `healing/damage/charm/ward/aura/global/aoe/steal/manipulation/enchantment/polymorph/curse/jinx/mutate/cloak` |
| `level/rank/wow` | 默认 `-1`，不限；指定时按整数精确匹配，范围 0–10000；不是最高等级或等级区间 |
| `exclusive/is_sentinel` | 未填表示不限；明确 `false` 会筛选否值，不会被当作未设置 |
| `search_by` | `Name`；另有精确 `Object`、`ID` 模式 |
| `show_spell_effects` | `false`，默认使用描述；开启显示已导入的效果树 |
| `num_targets` | 默认 1，允许 0–10000；未预编译值回退到只含通用行的 0 变体 |
| `use_object_name` | `false`；为 `true` 时按鱼类内部名筛选、去重并显示 |

学派与常用部位可用中文，例如 `-s 火焰 -k 帽子`；也支持简繁检索。原生怪物学派还包括 `star/sun/moon/shadow`；法术还包括 `gardening/fishing/cantrips/castlemagic/whirlyburly` 及这些扩展学派。计算的攻击学派可选七大基础学派及 `star/sun/moon/shadow`，不能选 `Any`；上限查询只接受七大学派。

`Name` 模式在满足筛选条件的记录中先精确匹配。无精确结果时按相近名称返回，开头明确显示“原查询 → 相近名称”；精确同名的多个变体全部保留。`Object` 和 `ID` 精确匹配，不运行相近搜索，也不再应用名称模式的筛选条件。完整大整数 ID 始终当字符串传递。`list` 是关键词包含匹配，按名称去重排序；`*` 匹配全部符合筛选的名称。

```text
wiz.item.find --search-by Name Sky Iron Hasta
wiz.item.list -s fire -k hat -l 170 *
wiz.spell.find --effects true --targets 3 Fire Cat
wiz.mob.find -k boss 怪物名称
wiz.mob.deck --search-by Object 完整内部名称
wiz.pet.list --wow 5 --exclusive false *
wiz.fish.list -r 2 --sentinel false --object-names true *
wiz.statcaps.find 179 fire
```

`statcaps.find 179 fire` 查询 170 档位并说明取整；支持的档位为 10、20、…、190。资料包缺记录时列出可用档位，不推算属性。旧 `wiz.statcaps fire 179` 保留旧的精确等级查询行为，参数顺序也不同。

### 新伤害计算：`calc` 与 `mob.calc`

```text
wiz.calc 1000 -d 100 -p 20 -c 500 -r 30 --block 200 --buffs "35 40 -50P" --pvp false
wiz.mob.calc -s fire --base 1000 -d 100 -p 20 -c 500 --buffs "35 -50P" --pvp false Lost Soul
```

| 参数 | 单位 / 要求 |
| --- | --- |
| `base` | 非负整数，单段基础伤害 |
| `damage` | 整数百分比，`100` 表示增加 100%；需由输入者确认面板口径 |
| `pierce` | 整数百分比 |
| `critical` | 整数暴击评级，不是倍率 |
| `resist` | 通用计算的整数抗性百分比 |
| `block` | 通用计算的整数格挡评级 |
| `buffs` | 可选字符串，默认空；按空格保留输入顺序，整体放在引号内 |
| `pvp` | 默认 `true`；PvE 需明确 `false` |
| `school` | 怪物计算的攻击学派，用于选取目标抗性 / 格挡；不会据此筛掉其他学派的怪物 |

`35` 为普通 +35% 乘法，`-25` 为普通负面乘法；大写 `20P` 增加穿透，`-50P` 为可被穿透抵消的减伤。每次伤害乘法都向零截断，最后分别显示不暴击和暴击结果。暴击倍率按参考提交计算：暴击为 0 时为 1；格挡为 0 时为 2；其他情况使用 `2 - k×block/(critical+k×block)`，PvP 的 `k=5`，PvE 的 `k=3`。不计算暴击概率。

PvE 分支不会自动应用伤害软上限曲线。通用计算的负抗性按上游增加余穿透，怪物计算的负抗性按上游转换为易伤；这些差异会在结果中说明。无效普通 Buff 项按上游忽略并报告，NaN / Infinity 会拒绝。

`mob.calc` 要求 0.3 导入的 `combat.complete=true`，含本体、所有关联装备及各学派目标属性。缺表或缺引用时拒绝计算；不会把未知装备当零。上游对重复属性、`polymorph` 和导出评级的处理也保留兼容说明，详见[功能对照](reference-parity.md#检索和计算行为)。

这是固定参考机器人的单段模型，不模拟 DoT、多段、吸收、转换、同源叠加合法性或完整战斗状态，不代表已验证当前游戏服务器机制。

### 旧简化计算器与升级

0.2 的简化 `wiz.calc` 已改名为 **`wiz.estimate`**。保留 `wiz.mobcalc` 作为旧入口：

```text
wiz.estimate 1000 -d 100 -b 40,35 -t 30 --shields 50 -w 25 -r 20 -p 30 -c 1.8
wiz.mobcalc 怪物ID 1000 -s fire -d 100 -c 1.8
```

这里 `-c` 仍是手动暴击倍率 1–10；刃 `-b`、陷阱 `-t`、盾 `--shields`、虚弱 `-w` 用逗号列出百分比，支持 `--flat-damage` / `--flat-resist`。旧 `mobcalc` 不接受 `base_only` 或不明确单位的抗性；发现新的完整 `combat` 时提示使用 `wiz.mob.calc`，避免混用两套模型。

0.2 词典、图标及旧 catalog schema 可继续加载；新增效果、普通 / 竞速天赋展示、原图字段及完整怪物汇总需要重新导入数据库。已有数据文件不会在启动时被自动改写。

### 词典、Wiki 与旧查询入口

| 指令 | 功能 |
| --- | --- |
| `wiz [名称]` | 默认类别搜索；无名称显示帮助 |
| `wiz.search -t 类别 -p 页码 名称` | 指定类别与页码；按 `dataSource` 选择来源 |
| `wiz.dict 名称` / `wiz.dict -f 关键词` | 离线名称 / 短文本查找；`-f` 扫描长对话 |
| `wiz.item/gear/spell/mob/pet/fish 名称或ID` | 旧类别查询入口 |
| `wiz.zone/npc/quest/talent/event/recipe 名称或ID` | 原有 Wiki 类别；配方依接口能力 |
| `wiz.list -t 类别 [关键词]` | 旧本地列表，可配合学派、部位、等级等筛选 |
| `wiz.statcaps 学派 等级` | 旧精确等级上限查询 |
| `wiz.detail 类别 完整ID` | 按 ID 查询 |
| `wiz.pick 序号` | 选择旧搜索列表中的候选 |
| `wiz.first/prev/next/last` | 旧搜索列表导航；远程总页数未知时不会猜末页 |
| `wiz.page 页码` / `wiz.page.first/prev/next/last` | 当前长回复、图卡或新路由列表导航 |
| `wiz.drops/cheats/deck 怪物ID` | 掉落 / 机制 / 牌库关系 |
| `wiz.where 游戏内部区域路径` | 按完整内部路径查区域 |
| `wiz.compare 物品ID_A 物品ID_B` | 同字段数值差异，不评估整套配装 |
| `wiz.status` | 权限等级 3：公开加载与缓存状态 |
| `wiz.sync [--bot 账号ID] [--guild 服务器ID]` | 权限等级 4：显式同步本插件 Discord 命令 |

可用于 `-t` 或 `detail` 的类型有 `item/spell/mob/pet/fish/statcaps/zone/npc/quest/talent/event/recipe`，`gear` 同 `item`。`defaultType` 可选的仍是原有常规类别，不含宠物、鱼类和上限。

旧查询过滤选项为 `-s` 学派、`-k` 部位 / 类型、`-l` 等级、`-r` 阶级、`--wow`、`--exclusive`、`--sentinel`、`--object`（布尔开关）、`--remote`。复杂筛选用于本地资料，不向尚未验证的 API 发送猜测过滤参数。新 `find` 使用 `--search-by Object`，不要与旧 `--object` 混淆。

启用中文别名后可用 `巫师百科`、`巫师词典`，以及 `巫师.装备.查询/列表`（也可用“物品”）、`巫师.法术.查询/列表`、`巫师.怪物.查询/列表`、`巫师.宠物.查询/列表`、`巫师.鱼类.查询/列表`。另有 `巫师.怪物.牌组`、`巫师.怪物.计算`、`巫师.属性上限.查询`、`巫师.计算`、`巫师.帮助`，覆盖全部 15 路由。选项仍使用短参数或英文名称，例如 `巫师.法术.查询 --effects true 火猫`。

## 名称、俗称与引用

词典将文件、key、英文原文和汉化文本一起保存。相同中文可能出现在不同实体、区域和对话中；本地化记录数不等于独立百科实体数。直接词典查询可查看候选和引用；不要把 key 当游戏模板 ID。

简繁统一只用于搜索，不改写显示译文。默认索引名称与不超过 200 字符的短文本，长对话使用 `wiz.dict -f` 显式扫描，可能比名称查询慢。英文显示翻译只在可唯一确定时替换，多译继续保留原文和候选。

社区俗称可在 `aliases` 中配置英文全名。多候选写成数组，不强行挑第一个：

```yaml
aliases:
  火猫: Fire Cat
  某个有歧义的俗称:
    - Example Name A
    - Example Name B
```

上例多候选名称是格式占位，不代表真实游戏对象。别名需由维护者结合类别核对，不能把本地词典中某个全局同名译文当成唯一来源。旧在线查询的中文模糊结果只作建议，不擅自据此查 API；新本地 `find` 的相近搜索会显式标注匹配名。

## 图卡、分页与原生交互

`replyMode: auto` 在 QQ 群 / C2C、QQ 频道和 Discord 尝试 PNG，其他平台返回文字；可显式选 `text` 或 `image`。默认小图标随包加载；某个语义键缺图时保留文字标签，中文字体不可用时回退文字。图片默认预算 2 MiB，发送失败只进行一次文字回退，不重复请求 API。

原图由 `portraitPath` 指定的本地 PNG 目录读取；数据库中的路径只用于生成文件名。文件名、PNG 格式、尺寸和实际路径均会校验，不跟随外部 URL。准备方法见[原图说明](../tools/catalog/README.md#原版画像与缩略图)。

普通文字指令的当前回复按用户及频道保存，约 10 分钟后过期；`wiz.page` 控制当前回复，新查询会替换该状态。旧搜索列表仍使用 `pick/next/prev`。超长内容会分段，完整详情与列表可以继续翻页，超出明确资源上限时返回错误，不假装只显示的前一部分就是全部。

Discord 原生命令默认关闭。启用流程：

1. 官方 `adapter-discord` 设置 `slash: false`。
2. 插件设置 `nativeDiscordEnabled: true`，按需填 `discordGuildId`。
3. 已挂载用户资料且 `session.user.authority ≥ 4` 的管理员执行 `wiz.sync`；未配置可核验的用户权限资料时拒绝同步。
4. 在自己的测试服务器验收查询、PNG、按钮和命令权限。

`discordCommandName: ''` 为 8 根命令，设 `wiz` 则为一个 `/wiz` 命名空间。插件不自动接管同名外部命令；备份 `data/wizard101/native-commands.json`，其中保存已登记命令 ID 与作用域。按钮绑定原消息与发起人，有效期 180 秒，翻页不续期，始终编辑原回复。

QQ `qqInputButtons` 默认关闭。自己的机器人具备自定义 Markdown 和内联键盘权限时可开启，按钮填入 `wiz.page.first/prev/next/last`，由玩家确认发送。QQ 频道保持文字分页。这不自动申请能力、注册后台菜单或创建模板。完整步骤见[平台说明](platforms.md)与[原生交互说明](native-interactions.md)。

## 服务端鉴权

Wizard404 查询需要自己的只读 API Key 和可联系的 User-Agent；本地词典、新图鉴路由与计算器不需要 Key。`apiKey` 在 Koishi 控制台为密码字段。配置留空时分别读取 `W404_API_KEY` 和 `W404_USER_AGENT`，显式非空配置优先。`authMode` 支持 `bearer` 或 `x-api-key`。

```sh
export W404_API_KEY='REPLACE_LOCALLY_WITH_YOUR_PRIVATE_KEY'
export W404_USER_AGENT='MyWizardWiki/0.3.1 (replace-with-your-contact@example.com)'
```

PowerShell 当前会话可用：

```powershell
$env:W404_API_KEY = 'REPLACE_LOCALLY_WITH_YOUR_PRIVATE_KEY'
$env:W404_USER_AGENT = 'MyWizardWiki/0.3.1 (replace-with-your-contact@example.com)'
```

变量须对实际 Koishi 进程可见。systemd 使用服务自己的环境文件，容器通过运行时环境注入，GUI 启动器按其设置配置；不要把个人终端里的变量误认为已传给后台服务。QQ AppSecret、Discord Token 和 Wizard404 Key 用途不同，不可互换。

密钥只放服务端，不放群消息、命令行参数、公开 Issue、截图或 Git 仓库。`baseUrl` 决定凭据发送的目标，只有确认服务归属时才修改。

## 在线接口联调

根据 [Wizard404 公开 OpenAPI](https://www.wizard404.com/api/v1/openapi.json) 配置了只读路径，但公开规范不足以确认所有名称查询参数、响应和分页。当前 `q/page/limit` 是可修改的默认值，**不是已经用真实 Key 证实的契约**。

```sh
node tools/probe-api.cjs --type mob --id 1749326 --out ./probe-detail.json
node tools/probe-api.cjs --type spell --query "Fire Cat" --search-param q --out ./probe-search.json
```

脚本只从环境变量读取 Key，不接受命令行密钥。名称探测对指定关键词和随机不存在的关键词进行对照，帮助发现上游忽略参数的情况；不会抓取全站。生成报告经过脱敏，分享前仍应确认没有敏感资料。

开放按名搜索前，应确认：目标类别支持该参数；存在 / 不存在关键词的结果能正确区分；条目 ID、名称及包装字段被适配；页码与下一页信息经过独立核实。探测报告会明确保留 `paginationVerified: false`，不能把一次成功请求当成分页已经验证。必要时调整 `searchParam/pageParam/pageSizeParam`，其中 `pageSizeParam: ''` 可不发送条数参数。

最后才设 `onlineSearchEnabled: true`。未知响应、空白、限流或权限不足都会提示，不把它们当作正式百科事实。远程边界和未调用的受限接口见[接口契约说明](api-contract.md)。

## 配置速查

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `command` | `wiz` | 主命令前缀 |
| `defaultType` | `item` | 原有入口默认类别：item、spell、mob、zone、npc、quest、talent、event |
| `enableChineseAliases` | `true` | 中文命令别名 |
| `localePath` | 空 | 默认中文词典路径 |
| `aliases` | `{}` | 俗称到英文全名 / 候选数组 |
| `catalogPath` | 空 | 默认数值资料包路径 |
| `dataSource` | `hybrid` | 原有查询入口的本地 / API 策略 |
| `replyMode` | `auto` | 自动图卡 / 文字；可选 text、image |
| `iconPath` | 空 | 优先已有 data/wizard101/icons，否则内置图标；可指定自定义 manifest |
| `fontPath` | 空 | 中文 TTF / OTF / TTC；空则自动发现 |
| `portraitPath` | 空 | 本地 PNG 原图目录 |
| `nativeDiscordEnabled` | `false` | 挂载原生交互；不会自动注册命令 |
| `discordCommandName` | 空 | 8 根命令；填 wiz 使用 /wiz 命名空间 |
| `discordGuildId` | 空 | 同步的默认测试服务器；空为全局 |
| `qqInputButtons` | `false` | QQ 群 / C2C 可选输入按钮 |
| `apiKey` | 空 | 留空读取 W404_API_KEY |
| `userAgent` | 空 | 留空读取 W404_USER_AGENT |
| `authMode` | `bearer` | 或 x-api-key |
| `baseUrl` | `https://wizard404.com/api/v1` | 只读 API 服务根地址 |
| `onlineSearchEnabled` | `false` | API 按名查询开关 |
| `searchParam` | `q` | 待部署端核实的名称参数 |
| `pageParam` | `page` | 待核实页码参数 |
| `pageSizeParam` | `limit` | 待核实条数参数，空字符串不发送 |
| `pageSize` | `8` | 旧搜索列表每页条数，1–10 |
| `minIntervalMs` | `1200` | 上游请求串行间隔 |
| `cooldownMs` | `1500` | 同会话指令冷却 |
| `timeoutMs` | `10000` | 单次请求超时 |
| `cacheTtlMs` | `900000` | API 缓存 15 分钟；0 关闭 |
| `maxCacheEntries` | `128` | API 内存缓存条数 |
| `maxCacheBytes` | `16777216` | API 原始响应文本总缓存预算 16 MiB；对象实际内存更大 |
| `maxResponseBytes` | `4194304` | 单次 API 响应上限 4 MiB |
| `maxQueue` | `12` | 待处理上游请求数上限 |

离线资料包、词典和图卡各有独立大小限制，不由 API 缓存参数控制。遇到上游额度或限流时插件执行冷却，避免并发堆积；不会替用户申请额度或绕过服务限制。停用插件时清理会话、请求、缓存和原生分页状态。

## 排错与验收

| 现象 | 检查方法 |
| --- | --- |
| 新 find/list 提示无本地资料 | 核对 catalogPath、实际类别和加载状态；配置 API Key 不会补齐本地数据库 |
| 法术只有原说明 | 用 0.3 导入器重导；确认 effects / spell_effects 表，必要时提供 --locale |
| 中文原说明仍未翻译 | 词典可能缺少完整模板或有多个译文；保留原文是预期行为 |
| 怪物计算拒绝 | 检查 combat.complete 及 warnings、mob_stats / mob_items / items / item_stats；旧 base_only 不可直接算 |
| 宠物天赋分组不符 | 核对数据是否遵循前 10 行普通天赋约定，不手工猜分组补数据 |
| find 返回相近名字 | 查看顶部匹配提示；用 --search-by ID 或 Object 精确定位 |
| 只发文字 | 检查 replyMode、中文字体和图片发送权限；小图标缺失不等于词典缺失 |
| 图卡没有小图标 | 检查显式 iconPath 是否有效；留空可自动使用随包图标，并兼容已有有效旧清单 |
| 没显示原图 | 核对 portraitPath 和导出 portrait 文件名；只接收受限的本地 PNG |
| Slash 不出现 | 检查 nativeDiscordEnabled、适配器 slash:false、应用授权、同步作用域、管理员用户权限和 wiz.sync 结果 |
| 同步提示名称冲突 | 保留其他插件命令；恢复本插件归属文件或选择未占用命名空间 |
| QQ 输入按钮不可用 | 确认自定义 Markdown / 内联键盘权限；没有则关闭 qqInputButtons 使用文字 |
| 在线名称总返回同一页 | 关闭在线按名搜索，重新核实名称与分页契约 |
| 0.2 计算示例报错 | 原简化 calc 使用 wiz.estimate；新的 -c 是整数评级 |
| 翻页失效 | 普通回复约 10 分钟，Discord 原生 180 秒；重新查询 |

自动测试只证明本地代码与夹具、核对版本的适配器路径一致。部署后仍需用自己的资料版本、测试群 / 服务器和授权 Key 验收；仓库不会声称真人 Bot、完整游戏 DB 或远程 Wiki 已经验证。建议先检查离线帮助、词典、各类别查询和计算，再检查图卡与分页，最后启用远程查询和显式同步原生命令。
