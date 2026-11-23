# Wizard101 中文图鉴机器人

**Koishi 插件 · Kimerith 中文兼容实现 · QQ 官方 Bot / Discord · 原版图标资料卡**

从自己的 Wizard101 汉化 WAD / UTF-16LE LANG 建立中英词典，从 `wizdb` 数据库导入装备、法术、怪物、宠物、鱼类和属性上限。玩家可用中文或英文查询，查看中文法术效果、怪物本体与全部关联装备的属性，以及带原版图标和可选原图的 PNG 资料卡。另保留 Wizard404 在线百科查询。

**当前为 0.3.1，提供源码和本地打包安装流程，尚未发布到 npm 或 Koishi 插件市场。** 已实现 [Kimerith-WindHammer 固定提交 `3c24847d`](https://github.com/MajorPain1/Kimerith-WindHammer/tree/3c24847d111387fc0b34772b548f74e80089599f) 的全部 15 条公开命令路由，并移植、适配相关算法；代码采用 **GPL-3.0-only**。这里的“全部”指该提交的命令和已定义处理分支，不表示已经取得完整游戏数据库或验证当前游戏服务器的所有行为。

自动化使用合成 SQLite、合成资料和实际官方适配器的本地替身。**尚未使用真实机器人账号完成 QQ / Discord 在线验收，也未使用有效 API Key 完成 Wizard404 远程联调；完整真实游戏数据库尚待部署者导入验收。** 在线按名搜索与 Discord 原生命令默认关闭。

**原版小图标已随仓库和安装包提供。** `assets/icons` 包含 323 个 PNG 及对应语义清单，可直接用于学派、魔豆、属性、宠物五维和状态等图卡元素。默认配置无需再下载或转换 `Icons.zip`。完整词典、游戏数据库、法术 / 怪物画像、字体和密钥仍由部署者准备；素材来源和权属见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

[快速开始](#快速开始) · [完整使用手册](docs/usage.md) · [15 路由功能对照](docs/reference-parity.md) · [QQ / Discord 接入](docs/platforms.md) · [原生命令与按钮](docs/native-interactions.md)

## 0.3 能做什么

| 能力 | 实现与资料条件 |
| --- | --- |
| 装备 `find/list` | 名称 / Object / ID、学派 / 部位 / 等级筛选；覆盖上游 135 个属性哈希、装备限制、插槽、自带卡、Maycast、牌组参数与标记 |
| 法术 `find/list` | 中文描述模板、X 豆与特殊学派类别、用途标记；移植 119 种有专门解释的效果，识别全部 152 个效果枚举，支持层级、条件、随机分支、转换和目标数变体 |
| 怪物 `find/list/deck/calc` | 基础资料、AI 与采集标记；汇总本体及 `mob_items` 全部关联装备，按上游顺序组合牌组，使用完整汇总资料进行伤害计算 |
| 宠物 `find/list` | 蛋、五维、Wow、专属、自带卡、普通与竞速天赋；天赋分组遵循上游记录顺序约定 |
| 鱼类 `find/list` | 学派、阶级、哨兵筛选、内部名列表、速度与咬钩参数；按基础长度乘尺寸倍率计算最小 / 最大长度 |
| `statcaps.find` | 七大学派的 10–190 级档位；输入等级向下取到十级档位，例如 179 查询 170 |
| `calc` / `mob.calc` | 上游兼容的有序 Buff、穿透、抗性、暴击 / 格挡评级及 PvP / PvE 倍率，显示逐步结果与已知兼容差异 |
| 中文查询 | 简繁统一检索、俗称、同名多记录；`find` 无精确名称时明确显示相近匹配，`list` 按关键词列出并去重 |
| Discord 原生交互 | 默认布局为 8 个根 Slash 命令、15 条路由，提供中文选项和首页 / 上一页 / 下一页 / 末页按钮；每条消息独立分页 |
| QQ 官方机器人 | 同一组文字指令和图卡；已获平台 Markdown / 按钮权限时可选输入按钮，QQ 频道使用文字分页 |
| Wiki 扩展 | 保留区域、NPC、任务、活动、天赋、配方、掉落、机制、物品对比等 Wizard404 适配；实际覆盖取决于接口和授权 |

上游本身没有单独说明的 33 个效果枚举，以及未知条件或字段，会保留原名、原值和提示，不生成猜测说明。怪物关联表不完整时拒绝目标伤害计算。细节见[功能对照](docs/reference-parity.md)及[数据库导入说明](tools/catalog/README.md)。

运行时只需要 Node.js / Koishi，不需要 Python、数据库服务器或大模型服务。Python 仅用于离线导入；小图标已内置，游戏文本、数值资料和可选原图分别配置。

## 快速开始

### 1. 从源码安装

需要 **Node.js ≥22**、**Koishi `^4.18.11`**。数据库导入需要 **Python ≥3.10**；仅在转换自定义图标时另需 Pillow，使用内置图标不需要转换工具。图卡渲染仍需可用的中文字体。

```sh
git clone https://github.com/adquantum/koishi-plugin-wizard101.git
cd koishi-plugin-wizard101
npm ci
npm run check
npm test
npm pack
```

完整测试环境也需 Python ≥3.10、Pillow 和中文字体。Linux 可安装 `fonts-noto-cjk`。在实际运行 Koishi 的应用目录安装本地生成的包：

```sh
npm install --save /absolute/path/to/koishi-plugin-wizard101/koishi-plugin-wizard101-0.3.1.tgz
```

### 2. 准备中文词典和游戏资料

在插件源码目录执行以下命令；输出目录为自己的 Koishi 应用数据目录。路径含空格时加引号。

```sh
# WAD、单个 LANG 或 LANG 目录 → 中英词典
node tools/locale/import.cjs \
  --input /path/to/Locale_en-US-Root.wad \
  --output /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz

# 只读导入数值资料；--locale 用于名称及原始法术说明的中文化
# --decks 可省略；有独立牌组库时建议提供
python3 tools/catalog/from-sqlite.py \
  --input /path/to/items.db \
  --decks /path/to/decks.db \
  --locale /absolute/path/to/koishi-app/data/wizard101/locale-zh.json.gz \
  --version "自己确认的游戏或资料版本" \
  --output /absolute/path/to/koishi-app/data/wizard101/catalog.json.gz

```

LANG 按 UTF-16LE 读取，空行可能是有效字段；不要先删除空行或改编码。本地化 key 也不是百科条目 ID。`--locale` 只采用可唯一确定的翻译，未匹配的名称和原说明继续保留原文；结构性效果和状态术语仍有中文解释。

`iconPath` 留空即可加载随包的小图标。已有有效 `data/wizard101/icons/manifest.json` 的部署继续优先使用该自定义目录；该旧清单缺失或损坏时回退到内置图标，损坏原因保留在状态信息中。需要替换或补充图标时可使用[图标导入工具](tools/icons/README.md)。

可选的法术 / 怪物原图放入本地目录，通过 `portraitPath` 配置。导入器根据数据库 `image_file/image` 生成 PNG 文件名，机器人只读取本地 PNG，不下载原图。命名和限制见[导入说明](tools/catalog/README.md#原版画像与缩略图)。

### 3. 启用插件

把以下内容合并到现有 Koishi 配置。相对路径以 **Koishi 应用根目录**为准。

```yaml
plugins:
  wizard101:
    command: wiz
    localePath: data/wizard101/locale-zh.json.gz
    catalogPath: data/wizard101/catalog.json.gz
    iconPath: '' # 留空使用随包图标；兼容已有 data/wizard101/icons
    fontPath: ''
    portraitPath: data/wizard101/portraits
    dataSource: hybrid
    replyMode: auto
    nativeDiscordEnabled: false
    qqInputButtons: false
    onlineSearchEnabled: false
```

先用 `wiz.dict Fire Cat` 检查词典，再用 `wiz.spell.find Fire Cat` 检查本地资料。实际命中取决于自己的文件。没有数据库也可使用词典、通用伤害计算和另行配置的 Wiki API；新 `find/list` 路由固定使用本地资料。

### 4. 接入 QQ / Discord

在 Koishi 应用目录安装所需的官方适配器：

```sh
npm install @koishijs/plugin-adapter-qq@4.14.0 @koishijs/plugin-adapter-discord@4.6.2
```

QQ 使用 AppID + AppSecret，Discord 使用 Bot Token。两端普通文字指令均可用；`replyMode: auto` 尝试生成图卡，缺字体或发送失败时回退文字。

Discord 原生命令须把官方适配器设为 **`slash: false`**，再开启插件的 `nativeDiscordEnabled: true`。由 **Koishi 权限等级 4** 的管理员执行 `wiz.sync`；启动插件本身不会注册命令。默认创建 `/item`、`/spell`、`/mob`、`/pet`、`/fish`、`/statcaps`、`/calc`、`/help` 八个根命令；也可设 `discordCommandName: wiz` 使用一个 `/wiz` 命名空间。同步只管理本插件登记的命令 ID，同名外部命令会阻止同步，不覆盖其他插件。

详见[平台配置](docs/platforms.md)及[原生命令、归属文件和按钮有效期](docs/native-interactions.md)。QQ 输入按钮默认关闭，需要自己的机器人已经取得相关平台能力。

## 常用指令

以下使用默认前缀 `wiz`。**名称参数会读取余下整段文本，选项应放在名称前。** 英文名称可以包含空格。

| 示例 | 用途 |
| --- | --- |
| `wiz.help` | 查看中文命令帮助 |
| `wiz.dict 火猫` / `wiz.dict -f 对话关键词` | 离线词典；`-f` 扫描长文本 |
| `wiz.item.find --search-by Name Sky Iron Hasta` | 装备完整资料 |
| `wiz.item.list -s fire -k hat -l 170 *` | 火系、170 级帽子名称列表 |
| `wiz.spell.find --effects true --targets 2 Fire Cat` | 法术完整效果及指定目标数变体 |
| `wiz.mob.find Lost Soul` / `wiz.mob.deck Lost Soul` | 怪物本体与装备属性 / 牌组 |
| `wiz.pet.list --wow 5 --exclusive false *` | 非专属、Wow 为 5 的宠物 |
| `wiz.fish.list -s ice -r 2 --sentinel false --object-names true *` | 按内部名显示符合条件的鱼 |
| `wiz.statcaps.find 179 fire` | 查询火系 170 级上限档位 |
| `wiz.calc 1000 -d 100 -p 20 -c 500 -r 30 --block 200 --buffs "35 -50P" --pvp false` | 上游兼容单段伤害计算 |
| `wiz.mob.calc -s fire --base 1000 -d 100 -p 20 -c 500 --pvp false Lost Soul` | 读取怪物汇总抗性、格挡后计算 |
| `wiz.page 2` / `wiz.page.next` / `wiz.page.last` | 当前资料卡或新列表翻页 |
| `wiz.search -t spell Fire Cat` / `wiz.detail mob 1749326` | 旧查询入口，遵循 `dataSource` 策略 |
| `wiz.drops 怪物ID` / `wiz.cheats 怪物ID` | Wiki 掉落 / 机制 |
| `wiz.status` | 权限等级 3：加载与缓存状态 |

`wiz.calc` 中 `critical/block` 是**评级**，不是手动暴击倍率；`buffs` 以空格按顺序输入，`P` 为大写后缀。计算器复现固定上游算法，包括逐步向零截断及已说明的兼容差异，不代表对当前游戏服务器的完整模拟。全部选项和旧指令见[使用手册](docs/usage.md#完整指令)。

## 升级说明

### 从 0.3.0 升级

更新到 0.3.1 后，源码和 `npm pack` 安装包都带有默认 PNG 图标，无需单独复制图标目录。保持 `iconPath: ''` 即可；原先配置的自定义路径仍可使用。若旧配置显式指向一个并不存在的图标目录，请清空该字段以启用自动加载。本次图标更新不要求重新导入已有的 0.3 数值资料。

### 从 0.2 升级

0.2 的词典、图标、原有 `catalog.json(.gz)` 结构仍可读取，原有 `wiz.item/spell/mob`、`pick/next`、API 查询等继续保留。**旧版简化 `wiz.calc` 改名为 `wiz.estimate`**，旧 `wiz.mobcalc` 保留；不要把旧 `-c 1.8` 手动倍率传给新的 `wiz.calc`。

已有数值资料包不会自动增加法术效果、完整怪物装备汇总和新展示字段。需要这些功能时，用 0.3 导入器重新导出 `items.db`，并提供 `--locale` / 可用的 `--decks`。`base_only` 的旧怪物资料不能用于需要完整目标抗性的计算。

升级后的程序代码许可为 GPL-3.0-only，随包图标保留原素材权属。早期原创代码的 MIT 通知保留在 [LICENSES/MIT-legacy.txt](LICENSES/MIT-legacy.txt)，不代表 0.3 整包仍按 MIT 授权。

## Wizard404 在线扩展

在 Koishi 服务环境设置 `W404_API_KEY`、`W404_USER_AGENT`，或填写插件密码字段和 User-Agent。二者均非空后才能联网；不要把 Key 放入 GitHub 或群聊。

```sh
export W404_API_KEY='REPLACE_LOCALLY_WITH_YOUR_PRIVATE_KEY'
export W404_USER_AGENT='MyWizardWiki/0.3.1 (replace-with-your-contact@example.com)'
node tools/probe-api.cjs --type mob --id 1749326 --out ./probe-detail.json
node tools/probe-api.cjs --type spell --query "Fire Cat" --search-param q --out ./probe-search.json
```

名称参数 `q`、页码 `page`、条数 `limit` 是可配置的适配默认值，仍需有效 Key 核实。确认类别响应和分页后才开启 `onlineSearchEnabled`；该开关不影响本地检索或按 ID 查询。新 15 路由中的图鉴查询固定使用本地资料；`dataSource` 和 `--remote` 控制原有 Wiki 查询入口。详见[服务端鉴权与联调](docs/usage.md#服务端鉴权)和[接口契约](docs/api-contract.md)。

## 开发、来源与验证

```sh
npm run check
npm test
npm run check:public
```

测试覆盖 UTF-16LE / WAD 导入、简繁与歧义、大整数 ID、SQLite 关联、效果树与目标变体、135 属性与怪物装备合并、上游计算、PNG 渲染、15 路由、平台编码、命令归属、四按钮分页及降级。成功的本地测试不替代真实平台账号、完整资料库和远程 API 验收。

主要代码：`lib/kimerith-controller.cjs` 连接路由，`lib/kimerith-search.cjs` 负责参考检索，`lib/kimerith-views.cjs` 组织资料，`lib/kimerith-math.cjs` 实现参考计算，`lib/interactions.cjs` 处理原生交互。只读数据库导入位于 `tools/catalog/`；原有词典、API、卡片及发送模块继续共用。参与开发见 [CONTRIBUTING.md](CONTRIBUTING.md)。

上游元数据列出作者 **Valentin B.**，本项目同时保留仓库维护者 **MajorPain1** 与 **Kimerith-WindHammer contributors** 的归属。本项目将相关逻辑移植为 Koishi / 中文展示 / 离线导入，并保留来源和修改说明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)与 [GPL-3.0 许可证](LICENSE)。游戏文字、社区译文、图片、API 数据和依赖各自保留其权利归属。

接口与格式来源：[Wizard404 API](https://wizard404.com/api/v1/docs) · [OpenAPI](https://www.wizard404.com/api/v1/openapi.json) · [wizdb](https://github.com/MajorPain1/wizdb) · [Koishi](https://koishi.chat/)。本项目是社区工具，与 KingsIsle Entertainment、Wizard101、Wizard404 或参考项目作者没有官方从属关系。
