# QQ 官方 Bot 与 Discord 接入

一个 Koishi 实例可以同时连接 QQ 官方机器人和 Discord，复用中文词典、本地资料、Wiki 客户端及 PNG 渲染器。普通文字指令均使用 `wiz`；Discord 另有完整原生 Slash Commands 和四按钮分页，QQ 群 / C2C 可按自己的平台权限选用输入按钮。

本版核对的适配器为 **`@koishijs/plugin-adapter-qq@4.14.0`**、**`@koishijs/plugin-adapter-discord@4.6.2`** 及对应的 `@satorijs/adapter-*` 实现。测试以真实适配器代码配合本地网络替身执行，未向真实账号、群聊或服务器注册命令和发送消息。升级适配器后应重新检查配置、事件和编码路径。

## 平台能力

| 场景 | Koishi 平台名 | 图文方式 | 分页与命令 |
| --- | --- | --- | --- |
| QQ 官方群聊 / C2C 单聊 | `qq` | PNG 在前、简短摘要在后，由适配器组合为富媒体消息 | 文字指令；有权限时可选输入按钮 |
| QQ 频道 / 频道私信 | `qqguild` | 摘要与图片按适配器分开发送 | 文字指令与 `wiz.page` |
| Discord 普通消息 | `discord` | 摘要和 PNG 附件，推荐 `handleMixedContent: attach` | 普通文字指令与 `wiz.page` |
| Discord 原生交互 | `discord` | 延迟响应后编辑原回复，支持文字或 PNG 附件 | 8 根 Slash / 15 路由，四按钮独立分页 |
| 其他 Koishi 平台 | 对应适配器 | `auto` 使用文字 | 以该适配器支持情况为准 |

QQ 后台命令菜单、能力申请和审核模板不由插件创建。QQ 输入按钮由玩家确认发送新的文字指令；Discord 按钮直接编辑原查询消息。二者采用各平台实际支持的交互方式。

## 安装与配置

在实际 Koishi 应用目录安装所需适配器；只用一个平台时只安装对应包：

```sh
npm install @koishijs/plugin-adapter-qq@4.14.0 @koishijs/plugin-adapter-discord@4.6.2
```

合并到现有 `koishi.yml`，保留原应用插件和命令前缀设置：

```yaml
plugins:
  adapter-qq:
    id: ${{ env.QQ_BOT_APP_ID }}
    secret: ${{ env.QQ_BOT_APP_SECRET }}
    type: public
    protocol: websocket
    sandbox: true
    intents: 33554432
    retryWhen: []

  adapter-discord:
    type: bot
    token: ${{ env.DISCORD_BOT_TOKEN }}
    slash: false
    handleMixedContent: attach

  wizard101:
    command: wiz
    localePath: data/wizard101/locale-zh.json.gz
    catalogPath: data/wizard101/catalog.json.gz
    iconPath: data/wizard101/icons/manifest.json
    fontPath: ''
    portraitPath: data/wizard101/portraits
    dataSource: hybrid
    replyMode: auto
    nativeDiscordEnabled: false
    discordCommandName: ''
    discordGuildId: ''
    qqInputButtons: false
    onlineSearchEnabled: false
```

这是两个适配器的组合示例，不要求同时部署两端。`wizard101` 可先保持全部在线可选功能关闭，验证文字和本地图鉴。环境变量须传入实际 Koishi 进程；QQ AppSecret、Discord Token 与 Wizard404 API Key 用途不同，不可互换。

`replyMode: auto` 在上述官方平台尝试图卡；`text` 只发文字，`image` 强制尝试图片。`fontPath` 留空会自动找中文字体，Linux 可安装 `fonts-noto-cjk`；缺字体或渲染失败时返回文字。原版小图标与可选本地 PNG 原图分别使用 `iconPath` / `portraitPath`，不会自动从网络下载。

## QQ 官方机器人

1. 在 [QQ 开放平台](https://q.qq.com/) 准备自己的机器人，取得 AppID、AppSecret。
2. 官方适配器 4.14.0 使用 `id` 和 `secret` 字段，由适配器获取并刷新访问令牌；按自己的机器人类型选择 `type`。
3. 配置测试成员、测试群、消息权限及可用连接方式。示例使用沙盒和 WebSocket；若部署条件要求 Webhook，按对应适配器及平台文档配置，不混用接入字段。
4. 在测试群发送 `@机器人 wiz.help`，再测试 `wiz.dict`、`wiz.item.find` 和 `wiz.page.next`。

示例的 `33554432` 为所核对适配器的 `USER_MESSAGE` 事件位，包含群 @消息和 C2C；需要 QQ 频道事件时在适配器控制台另行选取相应权限。正式上线前，按自己已完成的测试和平台配置调整 `sandbox`，不要仅复制示例作为审批完成的证明。

这里连接的是 QQ 官方机器人。OneBot、NapCat 和个人 QQ 登录不属于本文路径；本插件不要求使用这些方式。

### 图卡与被动回复

本地 PNG 以 `h.image(buffer, 'image/png')` 交给适配器。已核对版本通过 `file_data` 上传并用 `file_info` 发送；插件单张图片预算为 2 MiB，这是本插件预算，不是宣称 QQ 平台硬上限。

群聊 / C2C 图片摘要默认不带 URL，来源仍保留在图卡内；文字模式保留来源链接。链接发送、内容审核、上传和权限最终由平台决定，需自己的测试群验证。

本插件沿用当前 QQ 适配器对被动消息 ID 的保守有效窗口，缺消息 ID、缺时间戳或已过适配器窗口时不自动改成主动推送。每次 `wiz.page` 或按钮填入的指令由玩家重新发送，形成新的被动会话。网络或上传耗时导致回复失效时，需要玩家重新查询。

### 可选输入按钮

`qqInputButtons` 默认 `false`。只有自己的机器人已具备 **自定义 Markdown 和内联键盘权限** 时才设为 `true`：

```yaml
plugins:
  wizard101:
    qqInputButtons: true
```

群聊 / C2C 的首页、上一页、下一页、末页按钮填入 `wiz.page.first`、`wiz.page.prev`、`wiz.page.next`、`wiz.page.last`。玩家确认发送后查询对应页，不使用未经支持的回调事件冒充被动回复。QQ 频道编码器没有相同按钮分支，因此继续使用文字分页。

仅有模板权限而没有上述自定义能力时保持关闭。带键盘消息发送失败会进行一次普通文字回退；插件不自动创建审核模板、后台菜单或申请权限。细节见[QQ 输入按钮范围](native-interactions.md#qq-官方机器人的按钮范围)。

## Discord

在 [Discord Developer Portal](https://discord.com/developers/applications) 准备自己的应用和 Bot Token，将机器人授权到目标服务器。普通文字查询需要机器人能够读取相应消息；按自己的部署设置 Message Content Intent 及事件订阅。发送图卡还需频道中的查看、发送、附加文件权限；线程内使用时核对线程权限。

普通文字命令可以先测试 `wiz.help`、`wiz.dict Fire Cat`、`wiz.page 2`。命令前缀仍遵循当前 Koishi 应用设置，插件不会改写全局前缀。

### 原生 Slash Commands

**官方 Discord 适配器必须设为 `slash: false`。** 本插件维护自己的原生命令；已核对适配器的通用 Slash 导出会使用批量覆盖接口，不能同时让它管理相同应用的命令。

启用插件原生监听，并指定测试服务器：

```yaml
plugins:
  adapter-discord:
    type: bot
    token: ${{ env.DISCORD_BOT_TOKEN }}
    slash: false
    handleMixedContent: attach

  wizard101:
    nativeDiscordEnabled: true
    discordCommandName: ''
    discordGuildId: '你的测试服务器ID'
```

这一步只开启监听。由 **Koishi 权限等级至少 4 且用户权限资料已挂载** 的管理员执行：

```text
wiz.sync
wiz.sync --guild 你的测试服务器ID
wiz.sync --bot 你的Discord机器人账号ID --guild 你的测试服务器ID
```

没有可核验的 `session.user.authority` 时拒绝同步，不能靠缺省会话绕过权限。`--bot` 用于多机器人选择；未指定 `--guild` 时采用 `discordGuildId`，该配置为空才同步全局命令。测试服务器作用域适合初次验收，应用还必须已获得相应命令授权。

默认创建 `/item`、`/spell`、`/mob`、`/pet`、`/fish`、`/statcaps`、`/calc`、`/help` 八根命令，包含全部 15 路由与中文参数。若已有其他插件的同名命令，可配置 `discordCommandName: wiz`，得到 `/wiz item find`、`/wiz mob calc` 等命名空间。

插件先对全部计划名称检查归属，只 create 新的未占用名称，或 edit 自己已登记的命令 ID。不会 bulk overwrite、批量清理命令或接管同名外部命令。请备份 `data/wizard101/native-commands.json`；归属文件丢失后不会凭名称认领现存命令。切换布局或作用域不自动删除旧命令。

本版经 Gateway 接收交互；不要同时把应用的 Interactions Endpoint URL 指向另一个响应服务。授权、命令域、中文选项以及归属文件的详细说明见[原生交互文档](native-interactions.md)。

### 四按钮分页

收到 Slash 后先确认交互，再执行查询和渲染，最后编辑原回复。每条查询都有独立的首页 / 上一页 / 下一页 / 末页按钮，绑定应用、发起用户、频道、服务器和原消息 ID。其他人不能改变这条查询的分页。

按钮从第一条成功结果起有效 **180 秒**，翻页不续期；到期尝试禁用按钮，之后点击提示重新查询。长列表按需获取页面，点击末页直接定位。某数据页的文字过长时先走完其全部文字分段，再进入下一数据页；不会只留下开头。

图片失败只回退一次已取得内容的文字回复，不重新执行查询。停止插件时尝试禁用按钮并清理内存令牌；重启不会恢复旧按钮会话。

## 文字与图片的降级

外部资料通过 `h.text` / 专用转义进入消息，Discord 的 `@everyone`、`@here`、用户和角色 mention 不会由资料文本触发。原生回复还显式关闭 `allowed_mentions`。文字预算计算转义后的长度，长回复提供可操作的后续页。

图片发送失败后仅尝试一次文字回退；文字也失败时停止循环，日志不打印底层凭据、带令牌的 URL 或完整内部错误。失败可能来自实际权限、内容审核、网络或平台状态，本地替身无法证明这些外部条件已满足。

## 本地测试与部署验收

```sh
node --test test/platform.test.cjs test/interactions.test.cjs
```

测试验证平台分流、官方编码器载荷、PNG 附件、转义和 mention、QQ 被动会话、一次回退，以及 Slash 参数、命令归属、碰撞预检、交互确认、原消息编辑、发起者隔离、180 秒过期和长列表惰性分页。使用本地替身截获发送，没有真人机器人凭据或平台写入。

自己的测试环境应验收：帮助和词典、各本地类别、中文 / 英文 / Object / ID、长回复翻页、图片与字体、权限不足时的文字回退。Discord 还需检查只同步本插件命令、中文选项、四按钮及到期提示；QQ 需检查 @触发、被动回复、图片审核及已获权限的输入按钮。有效 Wizard404 Key 的远程验收独立进行，见[使用手册](usage.md#在线接口联调)。

## 核对来源

- [QQ 官方接入文档](https://bot.q.qq.com/wiki/develop/api-v2/)与[开放平台](https://q.qq.com/)。
- [Koishi QQ 适配器文档](https://koishi.chat/zh-CN/plugins/adapter/qq)、[QQ 4.14.0 包](https://www.npmjs.com/package/@satorijs/adapter-qq/v/4.14.0)、[消息编码器](https://github.com/satorijs/satori/blob/main/adapters/qq/src/message.ts)和[配置 Schema](https://github.com/satorijs/satori/blob/main/adapters/qq/src/bot/index.ts)。
- [Koishi Discord 适配器文档](https://koishi.chat/zh-CN/plugins/adapter/discord)、[Discord 4.6.2 包](https://www.npmjs.com/package/@satorijs/adapter-discord/v/4.6.2)、[适配器事件处理](https://github.com/satorijs/satori/blob/main/adapters/discord/src/utils.ts)。
- [Discord 应用命令](https://docs.discord.com/developers/interactions/application-commands)与[交互响应](https://docs.discord.com/developers/interactions/receiving-and-responding)。

外链当前内容可能更新；本项目测试和说明以本文所列安装版本及仓库实现为准。
