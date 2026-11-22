# Wizard101 中文图鉴机器人

**Koishi 插件 · QQ 官方 Bot / Discord · 原版图标资料卡 · 本地游戏资料与 Wiki 查询**

将 Wizard101 本地化文本转换成中英词典，从自己的 `wizdb` 数据库导入装备、法术、怪物、宠物、鱼类和等级属性上限，再通过 Wizard404 查询在线百科资料。两端共享带原版学派、魔豆、属性图标的 PNG 资料卡；长内容可翻页，图片不可用时回退文字。

**当前为 0.2.0 开发版。** 本地查询、导入、PNG 渲染、计算器和 Koishi 交互已有自动化测试；QQ / Discord 使用实际官方消息编码器做本地验证。尚未使用真实机器人账号做群聊验收，也未使用有效 API Key 完成 Wizard404 远程联调。在线按名搜索默认关闭。

公开仓库提供代码、导入工具和合成测试样例。**游戏 WAD、原版图标、完整词典、游戏数据库、字体文件及密钥不随仓库分发**；部署者导入自己有权使用的数据。

[快速开始](#快速开始) · [常用指令](#常用指令) · [完整使用手册](docs/usage.md) · [本地化导入](tools/locale/README.md)

## 功能

| 能力 | 行为 | 状态 |
| --- | --- | --- |
| 中英词典 | 名称、短文本、文件/key 引用互查；可扫描长对话 | 导入自己的词典后可离线使用 |
| 简繁与俗称 | OpenCC 统一检索形式，支持自定义英文名称映射 | 已实现 |
| 同名处理 | 中文对应多个英文时列出候选；保留原始来源 | 已实现 |
| 百科条目 | 物品、法术、怪物、区域、NPC、任务、天赋、活动 | 在线适配已实现，待真实联调 |
| 怪物资料 | 掉落、特殊机制、可抽取牌库 | 在线适配已实现，待真实联调 |
| 配方与对比 | 按 ID 查配方预览；比较两件物品同字段的数值 | 取决于上游实际数据 |
| 交互与缓存 | 候选选择、分页、会话隔离、TTL/LRU 缓存 | 已实现及测试 |
| 请求控制 | 服务端鉴权、串行请求、超时、额度冷却、响应大小上限 | 已实现及测试 |

新增功能：

| 能力 | 行为与条件 |
| --- | --- |
| 本地图鉴 | 导入自有 `items.db` / 可选 `decks.db`，离线搜索装备、法术、怪物、宠物、鱼类、属性上限 |
| 组合筛选 | 学派、部位/类型、精确等级、阶级/豆数；宠物 Wow/专属、鱼类哨兵标记 |
| 图示卡片 | 原版 DDS/TGA 一次性转 PNG；中英标题、属性图标、来源、长内容分页 |
| 单段伤害估算 | 刃、虚弱、陷阱、盾、穿透、抗性、固定增减伤与手动暴击倍率，逐步解释 |
| 双平台 | QQ 官方群/单聊与 Discord 图片发送，QQ 频道兼容；失败回退文字 |
| 完整导航 | `first/prev/next/last/pick` 控制查询列表；`page` 控制当前详情 |

机器人运行时不需要数据库服务器或大模型服务。本地资料包是有上限的 JSON/JSON.gz；Python 仅用于一次性图标/数据库导入。平台连接由官方 Koishi 适配器负责。

功能参考 [Kimerith-WindHammer](https://github.com/MajorPain1/Kimerith-WindHammer)，实现独立编写；详见[功能对照与数据条件](docs/reference-parity.md)。

## 图标、本地资料与双平台接入

原版图标与中文文本解决展示和译名；装备数值、宠物天赋池、鱼类参数仍需要游戏资料。三个导入文件分别配置，不互相冒充。

```sh
# 一次性转换 Icons.zip，需 Python 3 + Pillow
python -m pip install Pillow
python tools/icons/import.py --input /path/to/Icons.zip --output /path/to/koishi/data/wizard101/icons

# 只读导入 wizdb 数据库，Python 标准库即可；--decks 可省略
python tools/catalog/from-sqlite.py --input /path/to/items.db --decks /path/to/decks.db --version "自行确认的资料版本" --output /path/to/koishi/data/wizard101/catalog.json.gz
```

Koishi 配置中增加：

```yaml
catalogPath: data/wizard101/catalog.json.gz
iconPath: data/wizard101/icons/manifest.json
fontPath: ''
dataSource: hybrid
replyMode: auto
```

`dataSource` 控制资料查询来源。`hybrid` 的按名查询优先本地已收录类别，缺类别时进入 API 流程；已收录类别的本地搜索无结果时直接显示空结果。按 ID 查询则先找本地条目，未收录该 ID 时可查询 API。`local` 只查本地，`api` 让常规百科类别走 API；宠物、鱼类和属性上限始终需要本地资料，`wiz.list` 也始终查询本地资料包。

支持该选项的指令可用 `--remote` 显式选择 API，但它不覆盖 `local` 模式，也不适用于宠物、鱼类和属性上限。`onlineSearchEnabled` 只控制 API 按名搜索；本地检索、离线词典和按 ID 查询不受这个开关影响。进入 API 名称流程且开关关闭时，插件返回词典结果或提示；API 请求仍需有效 Key 和 User-Agent。

`auto` 在 QQ / Discord 尝试图片，其他平台使用文字；可选 `text` / `image`。PNG 不需要浏览器，但需要中文字体：自动发现 Noto Sans CJK、微软雅黑等，也可指定 `fontPath`；缺字体回退文字。Linux 可安装 `fonts-noto-cjk`。

平台安装：

```sh
npm install @koishijs/plugin-adapter-qq@4.14.0 @koishijs/plugin-adapter-discord@4.6.2
```

QQ 使用 **AppID + AppSecret**，Discord 使用 **Bot Token**。QQ 群/单聊输出一条富媒体消息；QQ 频道当前适配器会分成两条。此版本采用普通文字命令与指令分页，尚未注册 Discord 原生 Slash Commands、按钮或 QQ Markdown 模板。

详细操作：[QQ / Discord 部署](docs/platforms.md) · [图标与字体](tools/icons/README.md) · [本地数据库导入](tools/catalog/README.md)。缺少游戏数据库时，仍可用词典、伤害计算器和配置后的 API 查询。

## 快速开始

### 1. 准备环境与安装包

需要 **Node.js ≥22** 和 **Koishi `^4.18.11`**。以下步骤从源码生成本地安装包；本项目尚未发布到 npm 或 Koishi 插件市场。

```bash
git clone https://github.com/adquantum/koishi-plugin-wizard101.git
cd koishi-plugin-wizard101
npm ci
npm run check
npm test
npm pack
```

在实际运行 Koishi 的应用根目录安装生成的包：

```bash
npm install --save /absolute/path/to/koishi-plugin-wizard101/koishi-plugin-wizard101-0.2.0.tgz
```

### 2. 生成自己的中文词典

在源码目录运行导入工具，将输出放到 Koishi 的数据目录。输入支持 `.wad`、单个 `.lang` 或包含 `.lang` 的目录：

```bash
node tools/locale/import.cjs \
  --input /path/to/Locale_en-US-Root.wad \
  --output /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz
```

路径含空格时加引号。`.lang` 采用 UTF-16LE，空行可能是有效字段；不要先转换编码、删除空行或把本地化 key 当成 API 条目 ID。详见[导入说明](tools/locale/README.md)。

### 3. 启用插件

在 Koishi 控制台启用 `wizard101`，或把以下内容合并到现有配置。`localePath` 相对于 **Koishi 应用根目录**解析，也可填写绝对路径：

```yaml
plugins:
  wizard101:
    command: wiz
    localePath: data/wizard101/locale-zh.json.gz
    apiKey: ''
    userAgent: ''
    authMode: bearer
    onlineSearchEnabled: false
```

重新加载后可先测试离线词典。下面名称仅演示用法，具体能否命中取决于自己的汉化文件：

```text
wiz
wiz.dict 火猫
wiz.dict Fire Cat
wiz.dict -f 任务里的关键词
wiz.pick 1
wiz.next
```

### 4. 配置在线 API

在服务器环境设置 `W404_API_KEY` 和 `W404_USER_AGENT`，或在插件控制台填写对应字段。`User-Agent` 应包含工具名称与真实邮箱或项目地址；密钥只放在自己控制的服务端。

```bash
export W404_API_KEY='REPLACE_LOCALLY_WITH_YOUR_PRIVATE_KEY'
export W404_USER_AGENT='MyWizardWiki/0.2.0 (replace-with-your-contact@example.com)'
```

环境变量必须对 Koishi 进程可见。服务、容器、启动器的配置方式见[完整使用手册](docs/usage.md#服务端鉴权)。

先用内置脚本检查实际接口。它不接受命令行密钥参数，报告中会移除敏感字段：

```bash
node tools/probe-api.cjs --type mob --id 1749326 --out ./probe-detail.json
node tools/probe-api.cjs --type spell --query "Fire Cat" --search-param q --out ./probe-search.json
```

`q`、`page`、`limit` 目前是可修改的适配默认值，**尚未由有效 Key 联调确认**。名称探测会使用正常关键词和随机不存在的关键词做对照；通过一个样例不代表所有类别或分页均正确。确认要开放的类别、响应字段和分页后，再开启 `onlineSearchEnabled`。详见[在线联调](docs/usage.md#在线接口联调)与[接口契约说明](docs/api-contract.md)。

没有本地词典时，仍可配置 API 使用按 ID 查询；启用并验证在线搜索后，也可直接输入英文名称。

## 常用指令

默认前缀为 `wiz`。英文名可以含空格；`-t`、`-p` 等选项要放在名称前。

| 指令 | 用途 |
| --- | --- |
| `wiz.dict 名称` | 离线中英互查 |
| `wiz.dict -f 关键词` | 扫描长对话文本 |
| `wiz.search -t spell Fire Cat` | 按指定类别和数据来源策略搜索；仅 API 按名搜索需要开启在线搜索 |
| `wiz.item 名称或ID` / `wiz.spell 名称或ID` | 物品 / 法术查询 |
| `wiz.mob 名称或ID` | 怪物查询 |
| `wiz.zone` / `wiz.npc` / `wiz.quest` | 区域 / NPC / 任务查询，后接名称或 ID |
| `wiz.talent` / `wiz.event` | 天赋 / 活动条目查询，后接名称或 ID |
| `wiz.detail mob 1749326` | 按类型与完整 ID 查询详情 |
| `wiz.drops 怪物ID` / `wiz.cheats 怪物ID` / `wiz.deck 怪物ID` | 掉落 / 机制 / 牌库 |
| `wiz.recipe 配方ID` | 配方预览 |
| `wiz.compare 物品ID_A 物品ID_B` | 相同数值字段对比 |
| `wiz.where 游戏内部区域路径` | 按大小写敏感的内部路径查区域 |
| `wiz.pick 1` / `wiz.next` | 选择当前候选 / 翻页 |
| `wiz.status` | 公开的插件加载与缓存状态 |

0.2.0 新指令：

| 指令 | 用途 |
| --- | --- |
| `wiz.gear 名称或ID` | 装备查询，同 item |
| `wiz.pet -s fire --wow 5 名称` | 宠物与条件筛选 |
| `wiz.fish -s ice -r 2 --sentinel false 名称` | 鱼类与哨兵筛选 |
| `wiz.list -t item -s fire -k hat -l 170` | 本地火系 170 级帽子列表 |
| `wiz.item --object 内部Object名` | 本地内部名称检索 |
| `wiz.item --remote 物品ID` | 绕过本地查 API |
| `wiz.statcaps fire 170` | 已收录的精确等级上限 |
| `wiz.prev` / `wiz.first` / `wiz.last` | 上一页、首页、末页；远程总页数未知时不猜末页 |
| `wiz.page 2` | 当前详情/图卡第 2 页 |
| `wiz.calc 1000 -d 100 -b 40,35 -t 30 --shields 50 -r 20 -p 30 -c 1.8` | 单段伤害估算 |
| `wiz.mobcalc 怪物ID 1000 -s fire -d 100` | 使用来源明确的目标百分比抗性估算 |

`-d/-b/-t/-r/-p` 均为百分数，`-w` 表示虚弱减伤，`--shields` 为盾的正减伤百分比；`-c` 手动暴击倍率。多项状态用逗号分隔，固定值用 `--flat-damage/--flat-resist`。输入面板值应已处理游戏曲线，最终才向下取整。此模型不覆盖 DoT、多段、吸收、转换、同源叠加合法性、评级曲线或游戏逐阶段舍入；不是完整战斗模拟。`mobcalc` 不将模糊 rating 或未汇总装备的本体属性当完整抗性。

中文别名为 `巫师百科`、`巫师词典`。搜索状态按用户及频道隔离，约 10 分钟后过期。完整类别、配置和示例见[使用手册](docs/usage.md#完整指令)。

## 中文匹配与资料边界

中文精确匹配到唯一英文名称时，插件用该英文查询；多义词先列候选，模糊匹配只作建议。简繁归一化仅用于检索，展示仍保留本地化文件的原文。

本地化记录包含名称、台词、界面文字和重复项，记录数不代表独立百科实体数或 API 覆盖率。装备属性、掉落和任务关系以资料包或 API 实际数据为准；空列表不意味着游戏里不存在该物品或掉落。本地资料显示其版本，未提供版本会写“未标注”；不自动称作最新数据。

Boss 机制目前保留来源原文。装备对比只计算同字段差值，不换算评级或评估整套配装。法术牌图、全量 `bulk` 等上游接口存在角色限制，当前客户端不调用这些接口。

## 开发与验证

```bash
npm ci
npm run check
npm test
```

测试使用 Node.js 的测试运行器和 Koishi 官方 mock 适配器，覆盖导入边界、编码、简繁检索、同名选择、大整数 ID、会话隔离、消息元素转义、鉴权、限流、缓存和生命周期。HTTP 响应为合成测试数据，**不代表已完成真实 Wizard404 认证查询或真实群聊联调**。

新增测试覆盖 SQLite 导入、筛选分页、图标安全、真实中文 PNG、伤害估算与 QQ/Discord 官方编码器。完整执行还需 Python 3、Pillow 和中文字库；CI 已配置这些环境。机器人正常运行不需要 Python。

| 路径 | 作用 |
| --- | --- |
| `lib/index.cjs` | Koishi 入口、配置与指令注册 |
| `lib/controller.cjs` | 查询、候选、分页与会话状态 |
| `lib/bot-controller.cjs` / `lib/catalog.cjs` | 本地与在线图鉴、筛选、回复分页 |
| `lib/cards.cjs` / `lib/views.cjs` | 资料模型与 PNG 图卡 |
| `lib/platform.cjs` / `lib/calculators.cjs` | 双平台发送与伤害估算 |
| `lib/api.cjs` | 只读 API、鉴权、缓存、限流与无损 ID |
| `lib/locale.cjs` | 词典加载、简繁检索与歧义处理 |
| `lib/format.cjs` | 双语文本与来源展示 |
| `tools/locale/` | WAD / LANG 导入工具 |
| `tools/probe-api.cjs` | 服务端只读联调脚本 |
| `test/` | 可独立运行的合成测试 |
| `docs/usage.md` | 完整配置、运维和排错说明 |

欢迎提交包含复现步骤的 Issue 或 PR。接口适配变更请附最小脱敏响应和测试；不要提交 Key、完整汉化词典、原始游戏资源或未经授权的资料。

## 路线图

- 完成各类别的有效 Key 联调，固化响应与分页契约。
- 在可靠数据支持下建立物品获取来源的反向查询。
- 加入经校对的中文 Boss 机制与更完整的属性展示。
- 按真实资料版本继续补齐底层法术效果、怪物装备总属性与任务导航。
- 加入 Discord 原生 Slash / 按钮及 QQ 菜单交互。

## 许可证与来源

代码采用 [MIT License](LICENSE)。游戏文本、社区译文、API 数据及依赖分别遵循各自权利与许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。部署者自行准备有权使用的词典；公开仓库不提供完整游戏或汉化数据下载。

数据接口：[Wizard404 API](https://wizard404.com/api/v1/docs) · [OpenAPI](https://www.wizard404.com/api/v1/openapi.json)  
框架与工具：[Koishi](https://koishi.chat/) · [OpenCC-JS](https://github.com/nk2028/opencc-js)

本项目是社区工具，与 KingsIsle Entertainment、Wizard101 或 Wizard404 无官方从属关系。
