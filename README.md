# Wizard101 中文百科机器人

**Koishi 插件 · 中英术语互查 · Wizard404 只读百科查询**

将 Wizard101 本地化文本转换成可检索的中英词典，再通过 Wizard404 查询物品、法术、怪物、地点等资料。消息采用纯文本，保留英文名称与来源，适合接入已有的 QQ、Discord 等 Koishi 机器人。

**当前为 0.1.1 开发版。** 词典解析与 Koishi 交互已有自动化测试；在线客户端的路由、鉴权和限流逻辑已经实现，但还没有使用有效 API Key 完成 Wizard404 远程联调。在线按名搜索默认关闭，查询参数与成功响应结构仍需部署者验证。

公开仓库提供代码、导入工具和合成测试样例。**游戏 WAD、完整汉化词典及 API Key 不随仓库分发**；中文查询需从自己有权使用的本地化文件生成词典。

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

不需要数据库或大模型服务。现有 Koishi 适配器负责平台连接；本项目不提供机器人账号或平台登录功能。

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
npm install --save /absolute/path/to/koishi-plugin-wizard101/koishi-plugin-wizard101-0.1.1.tgz
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
export W404_USER_AGENT='MyWizardWiki/0.1.1 (replace-with-your-contact@example.com)'
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
| `wiz.search -t spell Fire Cat` | 按指定类别搜索，需先开启在线搜索 |
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

中文别名为 `巫师百科`、`巫师词典`。搜索状态按用户及频道隔离，约 10 分钟后过期。完整类别、配置和示例见[使用手册](docs/usage.md#完整指令)。

## 中文匹配与资料边界

中文精确匹配到唯一英文名称时，插件用该英文查询；多义词先列候选，模糊匹配只作建议。简繁归一化仅用于检索，展示仍保留本地化文件的原文。

本地化记录包含名称、台词、界面文字和重复项，记录数不代表独立百科实体数或 API 覆盖率。装备属性、掉落和任务关系以 API 实际返回的数据为准；空列表不意味着游戏里不存在该物品或掉落。

Boss 机制目前保留来源原文。装备对比只计算同字段差值，不换算评级或评估整套配装。法术牌图、全量 `bulk` 等上游接口存在角色限制，当前客户端不调用这些接口。

## 开发与验证

```bash
npm ci
npm run check
npm test
```

测试使用 Node.js 的测试运行器和 Koishi 官方 mock 适配器，覆盖导入边界、编码、简繁检索、同名选择、大整数 ID、会话隔离、消息元素转义、鉴权、限流、缓存和生命周期。HTTP 响应为合成测试数据，**不代表已完成真实 Wizard404 认证查询或真实群聊联调**。

| 路径 | 作用 |
| --- | --- |
| `lib/index.cjs` | Koishi 入口、配置与指令注册 |
| `lib/controller.cjs` | 查询、候选、分页与会话状态 |
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
- 根据数据授权和平台能力，扩展图鉴卡片与任务导航。

## 许可证与来源

代码采用 [MIT License](LICENSE)。游戏文本、社区译文、API 数据及依赖分别遵循各自权利与许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。部署者自行准备有权使用的词典；公开仓库不提供完整游戏或汉化数据下载。

数据接口：[Wizard404 API](https://wizard404.com/api/v1/docs) · [OpenAPI](https://www.wizard404.com/api/v1/openapi.json)  
框架与工具：[Koishi](https://koishi.chat/) · [OpenCC-JS](https://github.com/nk2028/opencc-js)

本项目是社区工具，与 KingsIsle Entertainment、Wizard101 或 Wizard404 无官方从属关系。
