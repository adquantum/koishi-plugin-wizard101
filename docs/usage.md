# 配置与使用手册

[返回项目首页](../README.md)

本文对应 `koishi-plugin-wizard101` 0.1.1。运行环境为 Node.js ≥22、Koishi `^4.18.11`。公开源码不含完整本地化词典，需要自行导入；在线接口仍需在部署端完成有效 Key 联调。

## 安装与本地化文件

按首页从源码执行 `npm ci`、`npm pack`，在实际 Koishi 应用目录安装生成的 `.tgz`，并启用 `wizard101`。本项目尚未发布到 npm 或 Koishi 插件市场，包名相同不代表远程 registry 中的包就是本项目。

输入可以是 `.wad`、单个 `.lang` 或语言文件目录。建议将生成结果保存在 Koishi 自己的数据目录，避免插件更新时覆盖：

```bash
node tools/locale/import.cjs --input /path/to/Locale_en-US-Root.wad --output /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz
node tools/locale/import.cjs --input /path/to/Spells.lang --output /absolute/path/to/koishi-app/data/wizard101/spells.json
node tools/locale/import.cjs --input /path/to/Locale/en-US --output /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz
```

Windows 示例：

```powershell
node tools/locale/import.cjs --input 'D:\Game Files\Locale_en-US-Root.wad' --output 'D:\Koishi\data\wizard101\locale-zh.json.gz'
```

`localePath` 支持绝对路径，或相对 Koishi 应用目录的路径；留空时读取该目录下的 `data/wizard101/locale-zh.json.gz`。更新词典后重新加载插件即可。输入文件不被修改；导入器只处理语言成员，不导出字体或贴图。编码、校验字段和重复引用的说明见[导入文档](../tools/locale/README.md)。

词典大时会消耗启动时间和内存：gzip 文件大小不是运行堆大小。资源有限的部署可以只导入需要的语言表；减少数据会缩小可查范围。

## 基础配置

把下面配置合并到已有 `plugins` 下，不要覆盖原有适配器或其它插件：

```yaml
plugins:
  wizard101:
    command: wiz
    defaultType: item
    enableChineseAliases: true
    localePath: data/wizard101/locale-zh.json.gz
    apiKey: ''
    userAgent: ''
    authMode: bearer
    baseUrl: https://wizard404.com/api/v1
    onlineSearchEnabled: false
    searchParam: q
    pageParam: page
    pageSizeParam: limit
    pageSize: 8
    minIntervalMs: 1200
    cooldownMs: 1500
    timeoutMs: 10000
    cacheTtlMs: 900000
    maxCacheEntries: 128
    maxCacheBytes: 16777216
    maxResponseBytes: 4194304
    maxQueue: 12
```

首次保持 `onlineSearchEnabled: false`。导入词典后即可离线查询；数字 ID 查询由 API 提供，不受名称搜索开关影响，但需要有效 Key 和 User-Agent。

## 服务端鉴权

支持两种方式，每次请求只发送所选的一种：

```http
Authorization: Bearer <API_KEY>
```

```http
X-API-Key: <API_KEY>
```

配置 `authMode: bearer` 或 `authMode: x-api-key`。`apiKey` 在 Koishi 控制台使用 secret 控件；留空时从 `W404_API_KEY` 读取。`userAgent` 留空时从 `W404_USER_AGENT` 读取。显式非空配置值优先。

Linux / Bash：

```bash
export W404_API_KEY='REPLACE_LOCALLY_WITH_YOUR_PRIVATE_KEY'
export W404_USER_AGENT='MyWizardWiki/0.1.1 (replace-with-your-contact@example.com)'
```

Windows PowerShell：

```powershell
$env:W404_API_KEY = 'REPLACE_LOCALLY_WITH_YOUR_PRIVATE_KEY'
$env:W404_USER_AGENT = 'MyWizardWiki/0.1.1 (replace-with-your-contact@example.com)'
```

占位内容需在自己的服务器上替换。联系方式应为实际邮箱或项目网址。环境变量必须对运行 Koishi 的进程可见：服务、容器或启动器未必继承另一终端设置的变量，应在对应启动环境中设置后重启。

Key 不应放入 URL、客户端脚本、群消息、Issue 或公开仓库。示例格式不是有效凭据；需要从服务方获得自己的只读 Key。

## 完整指令

以下使用默认前缀 `wiz`。如果 Koishi 全局设置了命令前缀，按该实例的规则添加。修改插件 `command` 后，所有点号子指令使用新名称。

英文名称可以含空格。`-t`、`-p`、`-f` 等选项放在名称前：

```text
wiz.search -t spell Fire Cat
wiz.search -t item -p 2 Sky Iron
wiz.dict -f 关键词
```

| 指令 | 行为 |
| --- | --- |
| `wiz` | 显示帮助 |
| `wiz 名称` | 按 `defaultType` 查询，默认物品 |
| `wiz -t 类别 名称` | 临时指定类别 |
| `wiz.dict 名称` | 离线中英名称、短文本或引用查询 |
| `wiz.dict -f 关键词` | 显式扫描长对话全文 |
| `wiz.search -t 类别 名称` | 按名称查询相应 API；可在名称前使用 `-p 页码` |
| `wiz.item 名称或ID` | 物品 |
| `wiz.spell 名称或ID` | 法术 |
| `wiz.mob 名称或ID` | 怪物 |
| `wiz.zone 名称或ID` | 区域 |
| `wiz.npc 名称或ID` | NPC |
| `wiz.quest 名称或ID` | 任务 |
| `wiz.talent 名称或ID` | 天赋 |
| `wiz.event 名称或ID` | 活动条目，不代表实时开放状态 |
| `wiz.recipe 配方ID` | 配方预览；没有配方按名搜索 |
| `wiz.detail 类别 ID` | 指定类型与 ID 查询详情 |
| `wiz.drops 怪物ID` | 已知掉落及关联来源 |
| `wiz.cheats 怪物ID` | 来源的机制说明；英文原文不会自动变成中文攻略 |
| `wiz.deck 怪物ID` | 来源记录的可抽取牌库 |
| `wiz.where 内部区域路径` | 使用 `object_name` 精确查询，区分大小写 |
| `wiz.compare 物品ID_A 物品ID_B` | 对比同路径的数值属性 |
| `wiz.pick 序号` | 选择本次搜索结果、名称候选或词典条目 |
| `wiz.next` | 当前查询下一页 |
| `wiz.status` | 显示可公开的加载、配置与缓存状态 |

支持的类型为 `item`、`spell`、`mob`、`zone`、`npc`、`quest`、`talent`、`event`、`recipe`，以及代码内列出的常见中文别名。数字 ID 会直接查询 API；在线名称搜索关闭时，名称查询返回本地词典。

中文命令别名 `巫师百科`、`巫师词典` 默认启用。与其它插件冲突时可关闭 `enableChineseAliases`。

候选状态按平台、机器人账号、用户和频道隔离，约 10 分钟后过期。另一个用户无法用 `pick` 选择你的结果。没有明确下一页字段或收到重复页面时，插件停止翻页。

`wiz.status` 标记了权限级别 3，但其内容本身只包含可公开状态。无数据库实例的权限行为可能不同，因此不要依赖这条命令保护秘密。

## 名称、俗称与引用

中文名需有确定的英文对应项，才用于在线搜索。多个英文候选由用户选择；没有精确对应时只给建议。OpenCC 用于简繁检索归一化，显示文字保留导入文件中的原始形式。

默认短文本索引长度为 200 字符；长对话可通过 `wiz.dict -f` 扫描。还可使用来源引用：

```text
wiz.dict Spells:FireCat
wiz.dict Locale/en-US/Spells.lang:FireCat
```

这些是引用格式示例，是否存在取决于导入文件。文件路径和 key 保留大小写、前导零及重复记录；同名表/key 不应被当成唯一条目。语言 key 也不是 API 的 `template_id`。

管理员可加入经过核对的俗称：

```yaml
aliases:
  火猫: Fire Cat
  铁矛: Sky Iron Hasta
  示例歧义俗称:
    - Fire Cat
    - Frost Beetle
```

以上仅示范配置，不表示每个社区都采用这些译名。一个别名最多 10 个英文候选，最多配置 1,000 个别名。列表形式保留歧义选择。

## 在线接口联调

已依据 [Wizard404 公开 OpenAPI](https://www.wizard404.com/api/v1/openapi.json) 核实只读路径：物品搜索使用 `/items`，法术等使用相应的 `/search`；配方使用 `/recipes/{id}/preview`。公开规范没有完整给出一般搜索 query 参数及成功响应 schema。

`q`、`page`、`limit` 是兼容层默认值，尚未获得有效 Key 的远程验证。客户端识别 `data`、`items`、`results` 等有边界的结构，但这种兼容不能替代真实样例。已知路由和待验证的字段边界见[接口契约说明](api-contract.md)。

在源码目录设置环境变量后运行：

```bash
node tools/probe-api.cjs --help
node tools/probe-api.cjs --type mob --id 1749326 --out ./probe-detail.json
node tools/probe-api.cjs --type spell --query "Fire Cat" --search-param q --page-param page --page-size-param limit --out ./probe-search.json
```

已安装到 Koishi 的版本也可这样运行：

```bash
node node_modules/koishi-plugin-wizard101/tools/probe-api.cjs --help
```

脚本只从环境变量读取 Key，不接受命令行密钥，不写入远程服务。名称探测请求一次指定关键词，再请求一次随机不存在的关键词；不会猜测大量参数或抓取全站。

开启线上名称查询前，核对以下实际结果：

1. 详情中的 ID、名称及字段属于请求目标。
2. 正常关键词返回预期内容，随机负对照返回空列表。
3. `searchParameterBasicCheck` 为 `true`，且人工核对响应内容。一个样例成功不能推广到全部类别。
4. 分页参数和下一页元信息已核实；脚本会明确标记 `paginationVerified: false`。
5. 验证计划开放的其它类别，再设置 `onlineSearchEnabled: true`。

```yaml
onlineSearchEnabled: true
searchParam: q
pageParam: page
pageSizeParam: limit
```

如果服务方确认采用不同参数，修改相应配置。`pageSizeParam` 可留空以省略该参数。未知结构会返回提示；不要把默认未过滤列表或错误页当作成功查询。

分享联调资料时，使用脚本生成的脱敏报告，并再次确认内容适合公开；无需提供 Key。ID 全程按十进制字符串处理，避免 JavaScript 或表格软件把大整数舍入。

## 额度、错误与缓存

目前接入依据的 Key 政策是每账号 120 次/分钟、突发容量 40，多个 Key 共享账号额度；实际端点限制和服务器响应优先。不要把“突发 40”补充解释成未提供的时间窗口。

- 远程请求串行且至少相隔 1,200 ms，理论约 50 次/分钟；其它程序也可能消耗同一账号额度。
- 同一会话默认冷却 1,500 ms，等待队列默认最多 12 项。
- 缓存默认 15 分钟、最多 128 项，同时限制原始响应文本为 16 MiB。此字节数不是 JavaScript 堆上限。
- 相同进行中请求合并；单条大于缓存预算的成功结果可正常返回，但不进入缓存。
- 401 不自动重试。429、503 遵守 `Retry-After`，提示秒数并等待用户之后重新查询。
- 429、503 没有有效等待头时，分别采用 60 秒和 30 秒的等待。
- 请求超时默认 10 秒，响应体上限默认 4 MiB。
- 远程基址要求 HTTPS，HTTP 仅限本机回环测试。API 重定向不会自动跟随。

只调用固定的只读路由。`bulk`、法术牌图及修改类接口没有纳入客户端；看到文档路径不代表普通 Key 具备相应角色权限。

## 配置速查

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `command` | `wiz` | 小写字母开头，可含数字和连字符 |
| `defaultType` | `item` | 默认查询类别 |
| `enableChineseAliases` | `true` | 启用两个中文命令别名 |
| `localePath` | 空 | 空值读取 Koishi 数据目录 `data/wizard101/locale-zh.json.gz`；也可指定自己的路径 |
| `aliases` | `{}` | 俗称到英文全名的映射 |
| `apiKey` | 空 | 留空读取 `W404_API_KEY` |
| `userAgent` | 空 | 留空读取 `W404_USER_AGENT` |
| `authMode` | `bearer` | 或 `x-api-key` |
| `baseUrl` | `https://wizard404.com/api/v1` | 建议保持官方地址，仅向可信服务发送密钥 |
| `onlineSearchEnabled` | `false` | 完成名称接口联调后开启 |
| `searchParam` | `q` | 待验证的名称参数 |
| `pageParam` | `page` | 待验证的页码参数 |
| `pageSizeParam` | `limit` | 待验证的条数参数，空字符串表示省略 |
| `pageSize` | `8` | 每页条数，范围 1–10 |
| `minIntervalMs` | `1200` | 请求间隔；远程至少 1,200 ms |
| `cooldownMs` | `1500` | 会话查询冷却 |
| `timeoutMs` | `10000` | 请求超时 |
| `cacheTtlMs` | `900000` | 缓存时长，0 关闭 |
| `maxCacheEntries` | `128` | 条目上限，范围 1–512 |
| `maxCacheBytes` | `16777216` | 原始响应文本字节预算 |
| `maxResponseBytes` | `4194304` | 单次响应体上限 |
| `maxQueue` | `12` | 等待队列上限，范围 1–32 |

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 安装后找不到插件 | 确认包安装在实际 Koishi 应用目录，并按原部署方式重新加载 |
| 没有中文词条 | 公开仓库不附完整词典；导入自己的文件并检查 `localePath` |
| 可以查词典但按名字不联网 | 默认行为；先完成接口验证再开启 `onlineSearchEnabled` |
| 提示 Key 或 User-Agent 缺失 | 检查配置值和运行进程的环境变量，替换占位内容 |
| 401 | 检查 Key 是否有效、是否被撤销或复制错误 |
| 403 / Cloudflare | 向服务方确认访问权限或限制，避免反复盲目请求 |
| 429 / 503 | 按提示等待后重新查询 |
| 中文名称有很多候选 | 核对文件/key 上下文，或配置明确英文别名 |
| 搜索总返回同一页 | 关闭在线按名搜索，重新核对搜索和分页参数 |
| 没有下一页 | 接口没有明确下一页或已经返回重复页面，插件停止翻页 |
| 掉落或机制为空 | 解释为来源未收录/未解析，不能断言游戏里没有 |
| 属性对比缺少项目 | 两条记录没有同路径数值时不把缺失值当 0 |
| 词典加载失败 | 检查路径、大小、schema，修正后重新加载；查看导入工具说明 |

## 贡献与资料来源

开发检查使用 `npm run check` 和 `npm test`。自动化测试不需要真实游戏数据或 API Key，HTTP 样例均为合成数据。新增响应适配时，请提供最小脱敏样例和针对性测试，并区分观察到的字段与推测字段。

本地化条目没有提供完整的装备、掉落、任务关系数据库。反向掉落、完整任务导航、配装评估和中文机制攻略需要可靠数据与独立实现；当前版本不宣称具备这些能力。

参考：[Wizard404 API](https://wizard404.com/api/v1/docs)、[Wizard404 About](https://wizard404.com/about)、[Koishi 指令开发](https://koishi.chat/zh-CN/guide/basic/command)、[Koishi 配置](https://koishi.chat/zh-CN/guide/plugin/schema)、[Koishi 生命周期](https://koishi.chat/zh-CN/guide/plugin/lifecycle)。代码及第三方资料的许可边界见 [LICENSE](../LICENSE) 和 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
