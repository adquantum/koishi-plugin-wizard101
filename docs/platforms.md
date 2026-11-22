# QQ 官方 Bot 与 Discord

同一个 Koishi 实例可以同时连接 QQ 官方机器人和 Discord，复用词典、百科客户端及图片卡片渲染器。玩家使用同一组 `wiz` 指令；查询结果通过各平台自己的官方适配器发送。

本文核对了 2026-11-22 npm 发布的 `@koishijs/plugin-adapter-qq@4.14.0`、`@koishijs/plugin-adapter-discord@4.6.2` 及其底层 `@satorijs/adapter-*` 源码。版本升级后，应重新验证图片发送与平台要求。

## 支持范围

| 场景 | Koishi 平台名 | 图文发送方式 | 查询交互 |
| --- | --- | --- | --- |
| QQ 官方群聊 / 单聊 | `qq` | PNG 在前、简短摘要在后，适配器合成一条富媒体消息 | 群内 @机器人 后输入指令；单聊直接输入 |
| QQ 频道 / 频道私信 | `qqguild` | 简短摘要与图片分为两条消息 | 按频道权限发送指令 |
| Discord 服务器 / 私信 | `discord` | 摘要在前、PNG 附件在后；推荐 `handleMixedContent: attach` | 普通文字指令 |
| 其他 Koishi 平台 | 相应平台名 | 自动模式保守返回文字 | 以该适配器支持情况为准 |

本轮采用共享的文字指令、候选序号和分页。尚未实现本插件专属的原生按钮或 Discord Slash Commands；QQ 后台的指令菜单也不会由插件自动创建。玩家仍可发送 `wiz.pick 1`、`wiz.next` 和 `wiz.page 2`。这样无需申请 QQ Markdown 模板或维护两套不同的按钮回调状态。

## 安装适配器

在实际运行 Koishi 的应用目录安装，或通过 Koishi 插件市场安装对应官方插件：

```sh
npm install @koishijs/plugin-adapter-qq@4.14.0 @koishijs/plugin-adapter-discord@4.6.2
```

适配器是 Koishi 应用的依赖，不是本插件的强制运行时依赖。只使用一个平台时，可以只安装对应适配器。

### 配置示例

将以下配置合并进现有 `koishi.yml`，保留原有插件与全局命令前缀。`wizard101` 本身的词典、API Key 和卡片设置见[完整使用手册](./usage.md)。

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
    handleExternalAsset: download

  wizard101:
    command: wiz
    replyMode: auto
    localePath: data/wizard101/locale-zh.json.gz
    catalogPath: data/wizard101/catalog.json.gz
    dataSource: hybrid
    onlineSearchEnabled: false
```

环境变量由实际启动 Koishi 的服务、容器或启动器传入；不要把真实凭据提交到 GitHub。QQ/Discord 的机器人凭据与 `W404_API_KEY` 是三个不同用途的凭据。

`replyMode` 支持 `auto`、`text`、`image`：自动模式为上述两个官方平台生成图片，文字模式关闭图片，图片模式可用于显式测试其他平台。`iconPath` 指向导入工具生成的 `manifest.json`；`fontPath` 可留空自动发现中文字体。缺少可用图片渲染条件时仍可返回文字。这里的示例没有填写图标和字体的机器专属路径。

上面的 QQ 示例显式开启沙盒。完成平台要求的配置与测试、准备接入正式用户时再将 `sandbox` 改为 `false`；`type` 应与自己的机器人类型一致。`33554432` 是适配器的 `USER_MESSAGE` 事件位，包含群 @消息与 C2C 单聊；需要 QQ 频道事件时，应在适配器控制台另行勾选对应权限，而不是照搬私域频道全部消息权限。

## QQ 官方机器人

1. 在 [QQ 开放平台](https://q.qq.com/) 创建或使用已有机器人，获取 AppID、AppSecret。
2. 安装官方 `adapter-qq`，配置 `id` 和 `secret`。不要使用 OneBot、NapCat 或个人 QQ 登录流程代替这项配置。
3. 配置机器人后台的测试成员、测试群及需要的能力，确保选择的连接方式可用。
4. 在测试群发送 `@机器人 wiz`，然后试用本地词典、卡片和分页；在线百科还需要另行配置 Wizard404 Key。

### 凭据与连接

`adapter-qq 4.14.0` 的实际配置字段是 **`id` 与 `secret`**，由适配器获取并刷新 QQ Access Token。部分旧版 Koishi 文档仍写 `id/token/key`，不适用于这个版本。QQ 官方文档也已标注旧 Token 鉴权弃用。

示例使用 WebSocket，无需为本插件单独提供 HTTP 图片服务器。若自己的机器人接入要求使用 Webhook，请依照适配器控制台和 QQ 官方要求配置事件回调及 HTTPS 服务；不要把这两种接入方式的配置混用。

### 图片与回复窗口

本插件把本地 PNG 作为 `h.image(buffer, 'image/png')` 交给适配器。QQ 4.14.0 会将它转换成 `file_data` 上传，再用 `file_info` 发送；较大文件还能走适配器的分片上传。当前插件默认将单张发送图片限制在 2 MiB，以控制处理时间与消息大小。这是插件自己的保守预算，不是 QQ 的平台硬上限。

QQ 群聊/C2C 的图片摘要默认移除 URL，图卡内仍保留资料来源；文字模式保留原始来源链接。平台可能限制链接发送，出现对应平台错误时应检查机器人权限及当前平台要求。

截至本文核对日，QQ 官方消息概述写明群聊与单聊的被动回复窗口为 60 分钟，单聊每条消息 4 次、普通群聊 5 次；特定管理员群有更高次数，频道仍为 5 分钟。**本次核对的适配器 4.14.0 仍只在约 5 分钟内自动携带被动回复 ID**，因此本插件采用更保守的适配器窗口：只回复当前有效会话，不将超时查询转换成主动推送。查询或上传太慢时，玩家需要重新发送指令。

本插件不会自行调用 QQ 的主动消息接口，也不会在后台持续向群里推送分页。每一次 `wiz.next` / `wiz.page` 都由玩家重新发起，产生新的被动回复会话。

## Discord

1. 在 [Discord Developer Portal](https://discord.com/developers/applications) 创建或使用已有应用，获取 **Bot Token**。
2. 将机器人邀请到服务器，并在目标频道授予查看频道、发送消息和附加文件所需的权限。线程内使用时，还需相应的线程发送权限。
3. 若使用普通文字命令，在开发者门户启用 **Message Content Intent**，并在适配器中订阅对应事件。当前适配器默认事件已经包含这个位，但开发者门户仍需允许它。
4. 配置 `handleMixedContent: attach`，让摘要随 PNG 附件一次发送。输入 `wiz` 时应遵循现有 Koishi 应用的命令前缀设置。

示例关闭适配器的 `slash`，避免把普通文字指令误认为本项目已经完成原生斜线交互。后续可以单独增加 Slash Commands 的注册、授权、参数映射和超时响应；不影响本轮文字命令功能。

Discord 普通消息正文上限为 2000 字符。发送层默认使用 1800 的预算，并额外计算官方适配器为 Markdown 转义增加的字符，避免大量反斜杠、星号等内容在编码后超限。用户、角色、`@everyone` 与 `@here` 的文本形态会被处理为不可 ping 的展示文字；外部资料始终通过 `h.text` 创建，不能注入 Koishi 消息元素。

## 长内容与降级

- 短内容可直接返回文字；图片模式使用 PNG 图卡配合简短摘要。
- 超过文字预算时，回复会明确说明文字未完整显示，并给出 `wiz.page 2` 等可操作的后续页指令，不把截断结果伪装成完整资料。
- 图片发送失败时，只尝试一次文字回退，复用已有查询结果，不重复请求 Wizard404。
- 文字回退仍失败时，不再循环重试。日志只说明失败类别，不打印底层含凭据、URL 参数或服务器路径的错误详情。
- QQ 当前会话缺少消息 ID、时间戳或已超过适配器回复窗口时跳过发送，避免产生未经请求的主动消息。

图片发送失败的原因可能是权限、内容审核、网络、文件大小或平台状态。自动化测试无法验证实际机器人的权限与审核结果，部署后应在自己的测试群/服务器做一次真实验收。

## 测试覆盖与验收

`test/platform.test.cjs` 验证平台分流、图文顺序、PNG 限制、文本注入、mention 处理、转义后的长度预算、分页提示、一次文字回退和 QQ 被动窗口。

其中三项真实编码器测试在安装 `@satorijs/adapter-qq@4.14.0` 与 `@satorijs/adapter-discord@4.6.2` 时执行；没有安装底层适配器时会明确标为跳过。测试以本地函数截获发送请求，不使用机器人凭据或真实网络消息。

另已使用上述版本的**实际官方 MessageEncoder**，把网络传输替换为本地 stub，确认：QQ 群输出一次带 `msg_id/msg_seq` 的富媒体请求；Discord 输出一次带正文和 PNG 的 multipart 请求；QQ 频道输出两条且图片仍带被动 ID。这是本地编码验证，未向实际群聊或服务器发送消息。

部署验收建议：两端分别测试帮助、中文/英文查询、同名候选、长结果翻页、图片发送和缺图标时的展示；QQ 额外检查 @触发、被动回复和不带 URL 的图片摘要，Discord 检查附件权限与正文命令 Intent。

## 核对来源

- [Koishi QQ 适配器文档](https://koishi.chat/zh-CN/plugins/adapter/qq)；配置以当前版本 Schema 为准。
- [QQ 4.14.0 npm 包](https://www.npmjs.com/package/@satorijs/adapter-qq/v/4.14.0) 与[官方消息编码器源码](https://github.com/satorijs/satori/blob/main/adapters/qq/src/message.ts)。
- [QQ 配置 Schema](https://github.com/satorijs/satori/blob/main/adapters/qq/src/bot/index.ts)。
- [QQ 官方启动接入](https://bot.q.qq.com/wiki/develop/api-v2/)、[消息收发概述](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)、[群聊发送接口](https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_groups_group_openid_messages.post.html)与[富媒体说明](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/rich-media.html)。
- [Koishi Discord 适配器文档](https://koishi.chat/zh-CN/plugins/adapter/discord)。
- [Discord 4.6.2 npm 包](https://www.npmjs.com/package/@satorijs/adapter-discord/v/4.6.2) 与[官方消息编码器源码](https://github.com/satorijs/satori/blob/main/adapters/discord/src/message.ts)。
- [Discord 消息正文与附件规范](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx)。
