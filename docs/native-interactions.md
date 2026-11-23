# Discord 原生命令与双端分页

Discord 支持与 Kimerith-WindHammer 对应的原生 Slash Commands、中文选项和四按钮分页。QQ 官方机器人继续使用相同查询能力的 `wiz` 文字指令；有平台权限时可额外显示指令输入按钮。

本文按实际安装的 `@satorijs/adapter-discord@4.6.2`、`@satorijs/adapter-qq@4.14.0` 核对。对应 Koishi 插件为 `@koishijs/plugin-adapter-discord@4.6.2`、`@koishijs/plugin-adapter-qq@4.14.0`。测试使用真实适配器代码和内存 HTTP 替身，未用实际机器人账号注册命令或发送消息。

## 启用 Discord 原生命令

在 Koishi 应用中安装官方适配器，并将下列字段合并进现有配置。API、中文词典、图标和字体配置见[使用手册](usage.md)。

```yaml
plugins:
  adapter-discord:
    type: bot
    token: ${{ env.DISCORD_BOT_TOKEN }}
    slash: false
    handleMixedContent: attach

  wizard101:
    command: wiz
    nativeDiscordEnabled: true
    discordCommandName: ''
    # 填自己的测试服务器 ID；留空表示全局命令。
    discordGuildId: '你的服务器ID'
    replyMode: auto
    qqInputButtons: false
```

**适配器的 `slash: false` 是必要条件。** Discord 4.6.2 的 `updateCommands()` 在 `slash: true` 时会调用全局命令批量覆盖接口。本插件单独维护自己的原生命令，因此关闭适配器的通用 Slash 自动导出，保留普通 Koishi 文字命令。源码可核对 [DiscordBot.updateCommands](https://github.com/satorijs/satori/blob/main/adapters/discord/src/bot.ts)。

开启 `nativeDiscordEnabled` 只挂载事件监听，不向 Discord 写入命令。必须配置 Koishi 用户数据库，并为管理员账号设置权限等级至少 4。同步入口显式要求已经验证的 `session.user.authority >= 4`；缺少用户数据库或已验证身份时会拒绝同步，不使用 Koishi 无数据库时的默认放行行为。管理员显式发送：

```text
wiz.sync
wiz.sync --guild 你的测试服务器ID
wiz.sync --bot 你的Discord机器人账号ID --guild 你的测试服务器ID
```

多台 Discord 机器人连接同一 Koishi 时，可用 `--bot` 指定目标；在目标 Discord 机器人所在频道发起时可直接选择当前机器人。省略 `--guild` 时使用 `discordGuildId`；该配置为空才同步全局命令。服务器命令适合先在测试服务器验证，且不出现在私信中。应用需要已经获得 `applications.commands` 授权；该 scope 也包含在 `bot` 授权中。参见 [Discord 命令授权与作用域](https://docs.discord.com/developers/interactions/application-commands#authorizing-your-application)。

本实现通过适配器的 Gateway 事件接收交互。不要把同一应用的 Interactions Endpoint URL 指向另外一个处理服务；Discord 的 Gateway 和 HTTP 交互投递方式互斥。详见 [Discord 交互投递说明](https://docs.discord.com/developers/interactions/receiving-and-responding#receiving-an-interaction)。

### 命令名称

`discordCommandName: ''` 保留上游八个根命令：

| 根命令 | 子命令 | 中文显示名称 |
| --- | --- | --- |
| `/item` | `find`、`list` | 物品／查询、列表 |
| `/spell` | `find`、`list` | 法术／查询、列表 |
| `/mob` | `find`、`list`、`deck`、`calc` | 怪物／查询、列表、牌组、计算 |
| `/pet` | `find`、`list` | 宠物／查询、列表 |
| `/fish` | `find`、`list` | 鱼类／查询、列表 |
| `/statcaps` | `find` | 属性上限／查询 |
| `/calc` | 无 | 计算 |
| `/help` | 无 | 帮助 |

共 15 条查询或计算路由。命令及选项提供 `zh-CN`、`zh-TW` 名称本地化，说明使用中文；结果交给中文百科控制器生成。英文系统标识保持上游名称，Discord 客户端会按所选语言显示中文名，交互载荷仍回传原英文标识。参见 [Discord 命令本地化](https://docs.discord.com/developers/interactions/application-commands#localization)。

如果同一个 Discord 应用已经有 `/help` 等命令，可改用 `discordCommandName: wiz`，通过 `/wiz item find`、`/wiz mob deck`、`/wiz calc` 等路径访问全部能力。此模式只注册一个根命令；中文客户端显示为“巫师百科”。其他命名空间须为 1–32 位小写英文字母、数字、下划线或连字符，且以字母开头。

### 完整参数

以下参数核对 [Kimerith-WindHammer 的命令源码](https://github.com/MajorPain1/Kimerith-WindHammer/tree/3c24847d111387fc0b34772b548f74e80089599f/bot/extensions)。表中列出系统参数名，Discord 界面同时提供中文名称及说明。`name` 是字符串，可传中文、英文、Object 名或完整 ID；大整数 ID 不会先转成 JavaScript 数字。`list` 中 `name: *` 表示列出符合筛选的全部名称，按页读取。

| 命令 | 参数 |
| --- | --- |
| `item find` | `name`、`school`、`kind`、`level`、`search_by` |
| `item list` | `name`、`school`、`kind`、`level` |
| `spell find` | `name`、`school`、`kind`、`rank`、`search_by`、`show_spell_effects`、`num_targets` |
| `spell list` | `name`、`school`、`kind`、`rank` |
| `mob find` / `mob deck` | `name`、`school`、`kind`、`rank`、`search_by` |
| `mob list` | `name`、`school`、`kind`、`rank` |
| `mob calc` | `name`、`school`、`base`、`damage`、`pierce`、`critical`、`buffs`、`pvp`、`search_by` |
| `pet find` | `name`、`school`、`wow`、`exclusive`、`search_by` |
| `pet list` | `name`、`school`、`wow`、`exclusive` |
| `fish find` | `name`、`school`、`rank`、`is_sentinel`、`search_by` |
| `fish list` | `name`、`school`、`rank`、`is_sentinel`、`use_object_name` |
| `statcaps find` | `level`、`school` |
| `calc` | `base`、`damage`、`pierce`、`critical`、`resist`、`block`、`buffs`、`pvp` |
| `help` | 无 |

学派与种类使用上游完整枚举，界面显示中文。`search_by` 默认为 `Name`，还可选 `Object`、`ID`。查询筛选默认学派/种类 `Any`，等级/阶级/Wow `-1`；`exclusive` 与 `is_sentinel` 留空表示不限，明确填写“否”会保留布尔值 `false`。法术效果默认关闭，目标数默认 1；鱼类列表默认显示正常名称。

计算命令的基础数值为必填整数；`buffs` 默认为空字符串，`pvp` 默认为 `true`。`damage` 按上游接口接收伤害百分比，不自动应用 PvE 伤害曲线；`critical`、`block` 为评级。计算规则及数据条件由百科控制器负责，交互层不另造一套公式。

## 四按钮分页

每次查询拥有自己的“首页／上一页／下一页／末页”按钮。按钮绑定 Discord 应用、发起用户、频道、服务器及原消息 ID；其他人点击只收到自己可见的说明。一个用户可以保留多条查询消息，它们的分页状态彼此独立。

有效期为 **180 秒**，从第一条结果成功返回开始计时，翻页不延长。到期后尝试编辑原消息禁用按钮，并显示已过期提示；如平台拒绝这次编辑，后续点击仍会明确提示过期。正常停用插件也会尝试禁用已创建的按钮。进程重启不恢复分页令牌，旧按钮点击后提示重新查询。

每次翻页编辑原回复，复用已有查询结果，不重新搜索 Wizard404。长列表使用惰性 `getPage(index)`：只读取实际访问的页面，点击末页直接定位末页。每条分页最多缓存三个已读取页面；默认同时保留 128 条活跃分页，容量满时使最早的分页过期。

文字按 Discord 转义后的长度预算处理。单个数据页过长时，四按钮会先遍历该页的文字分段，再进入下一个数据页；页脚同时显示数据页码和分段页码。不会为了符合消息长度静默舍弃后半段。图卡发送失败只尝试一次文字回退，使用已经取得的页面，不重复查 API；图片和文字都失败则记录不含底层凭据的失败信息。

Discord 要求交互在 3 秒内首次响应，响应令牌有效期为 15 分钟。这里收到命令后先发送延迟响应，再查询和渲染；分页采用更短的 180 秒产品有效期。参见 [Discord 初始响应及令牌说明](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-callback)。

## 命令注册如何避免影响其他插件

归属文件默认位于 Koishi 数据目录的 `data/wizard101/native-commands.json`，只保存应用 ID、服务器 ID、根命令名称和命令 ID。**请保留并备份这个文件**，它用于确认哪些外部命令由本插件创建。

管理员同步时，模块先读取目标作用域的命令列表，对全部计划注册的名称做碰撞检查。同名命令没有本插件对应的登记 ID，就停止整次同步，不覆盖该命令。检查通过后逐条 create/edit；只 edit 已登记的 ID。模块不调用 bulk overwrite、不批量删除命令，也不自动清理其他命名模式或其他服务器中旧的登记命令。

如果归属文件丢失或损坏，同名命令不会仅凭名称或描述被认领。应恢复自己的备份，或改用尚未占用的命名空间。不要通过删除其他插件的命令来解决名称冲突。切换根命令布局或同步作用域不会自动删除旧命令；请固定部署模式，若确需迁移，由管理员依据原登记 ID 单独处理旧命令。Discord 的创建接口本身会对同名命令进行更新，因此本插件在 create 前执行归属检查；同一应用不应同时运行其他自动重写这些命令的注册器。参见 [Discord 命令端点](https://docs.discord.com/developers/interactions/application-commands#endpoints)。

该归属文件不保存 Bot Token、Wizard404 Key 或交互令牌。交互令牌只在当前进程中保留至分页过期；按钮 custom ID 只有随机标识和翻页动作。

## QQ 官方机器人的按钮范围

`qqInputButtons` 默认关闭。已获平台批准的 **自定义 Markdown 和内联键盘权限** 时，可启用：

```yaml
plugins:
  wizard101:
    qqInputButtons: true
```

QQ 群聊/C2C 回复可以追加四个输入按钮，分别填入 `wiz.page.first`、`wiz.page.prev`、`wiz.page.next`、`wiz.page.last`。玩家确认发送后产生新的消息，按各自的用户/频道分页状态查询下一页。QQ 平台审核和该机器人的实际权限决定按钮是否可用；权限不足导致整条带键盘消息失败时，发送层会进行一次普通文字回退。

这里使用官方适配器现有的 `h('button', { type: 'input', text: '...' })` 能力，产生 `action.type: 2`，不会替用户申请平台能力，也不自动创建审核模板或后台命令菜单。只有模板权限而没有自定义 Markdown/内联键盘权限时，应保持关闭，使用文字指令。

QQ 4.14.0 的频道编码器没有同样的按钮分支，因此 `qqguild` 保持文字分页。QQ 群/C2C 按钮也不声称具备 Discord 的原消息编辑能力：当前 QQ 适配器对回调交互还注明不能依靠该交互 `event_id` 发送被动消息，本实现使用用户主动发送输入指令后的新会话。未开启按钮时，`wiz.page 2` 以及 `wiz.page.first/prev/next/last` 仍可使用。详见 [QQ 消息编码器](https://github.com/satorijs/satori/blob/main/adapters/qq/src/message.ts)与 [QQ 交互适配](https://github.com/satorijs/satori/blob/main/adapters/qq/src/utils.ts)。

## 交互模块接口

主插件已经负责接线；下面供维护和二次开发使用。该模块不调用旧的 `prepareReply()`，因此不会覆盖普通文字指令的分页状态。

```js
const { createNativeInteractions } = require('./lib/interactions.cjs');

const native = createNativeInteractions({
  commandName: '',
  registryPath: '/your/koishi/data/wizard101/native-commands.json',
  logger,
  redact: text => redactSecrets(text),
  execute: (session, route, params) => controller.execute(session, route, params),
  renderPage: async (page, session) => ({
    content: page.text, // 普通文字；模块统一转义，不要先转义 Markdown。
    // png: await renderer.render(page.card),
  }),
});

native.attach(ctx); // 只监听事件。
// 仅在管理员显式执行同步指令时调用：
await native.syncDiscord(bot, { guildId: '你的测试服务器ID' });
// 停用时：
await native.dispose();
```

`execute()` 接收 `item.find`、`mob.deck`、`calc` 等路由及原始 snake_case 参数。返回值支持两种形式：

```js
// 少量完整页面。
{ kind: 'wizard101.reply', pages: [{ text, card, summary }, ...] }

// 大型结果集。index 从 0 开始，getPage 可返回 Promise。
{ kind: 'wizard101.reply', pageCount: totalPages, getPage: index => makePage(index) }
```

`renderPage()` 接收已做字符串脱敏的单页，返回 `{ content, png? }`。PNG 默认上限 2 MiB；不上传 URL、不接受外部构造的 embeds 或 arbitrary message payload。所有正文进行 Discord Markdown 转义，并发送 `allowed_mentions: { parse: [] }`，防止 `@everyone`、`@here`、角色/用户 mention，以及伪装 Markdown 链接。

模块从 `discord/interaction-create` 接收本插件登记的 slash。适配器会忽略不在 `bot.commands` 中的 slash，因此此处自行发送一次 type 5 ACK。按钮使用适配器已经 type 6 ACK 后的标准 `interaction/button` 事件，不重复 ACK。编辑回复走适配器的认证 HTTP 客户端和 Discord 原消息 PATCH 接口，PNG 使用 `files[0]`、`payload_json` multipart 上传。没有使用会因图片而抛错的通用 `bot.editMessage()`。相关源码：[事件适配](https://github.com/satorijs/satori/blob/main/adapters/discord/src/utils.ts)、[Gateway 分发](https://github.com/satorijs/satori/blob/main/adapters/discord/src/ws.ts)、[内部 API](https://github.com/satorijs/satori/blob/main/adapters/discord/src/types/interaction.ts)。

## 已验证范围

运行：

```sh
node --test test/interactions.test.cjs
```

测试覆盖完整参数及两种命令布局、独立命令归属与碰撞预检、实际适配器的 ACK 次数、原消息编辑、用户/频道/消息隔离、180 秒过期、在途翻页与超时竞争、20 万页惰性定位、PNG 附件与一次文字回退、渲染前脱敏、Markdown/mention 处理和长页完整分段，以及 QQ 官方编码器生成的输入按钮载荷。

这些结果证明本地实现与已核对版本的编码和事件路径相容。Discord 应用授权、真实服务器权限、QQ 平台能力审批、网络连通和消息审核仍需部署者在自己的测试环境验收；本仓库测试不会替你向外部平台发送消息。
