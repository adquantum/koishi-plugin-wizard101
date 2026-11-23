# 第三方代码、资料与来源

## 0.3 整体许可

`koishi-plugin-wizard101` 0.3 整包按 **GPL-3.0-only** 提供，完整文本见 [LICENSE](LICENSE)。本版移植了 Kimerith-WindHammer 的相关代码与映射，不再沿用 0.2 文档中“独立实现、未移植、整包 MIT”的说明。

早期本项目原创部分的 MIT 版权与许可通知保留在 [LICENSES/MIT-legacy.txt](LICENSES/MIT-legacy.txt)。它用于保留该部分既有通知，不能把包含 GPL 移植代码的 0.3 整包表述为 MIT。新增和修改的兼容代码遵循本仓库整包许可，并保留相应来源说明。

## Kimerith-WindHammer

- 上游仓库：[MajorPain1/Kimerith-WindHammer](https://github.com/MajorPain1/Kimerith-WindHammer)。
- 固定参考提交：[`3c24847d111387fc0b34772b548f74e80089599f`](https://github.com/MajorPain1/Kimerith-WindHammer/tree/3c24847d111387fc0b34772b548f74e80089599f)。
- 署名：上游项目元数据列出 **Valentin B.**；保留仓库维护者 **MajorPain1** 与 **Kimerith-WindHammer contributors** 的归属。
- 本次移植以该提交根目录的 [GPL-3.0 LICENSE](https://github.com/MajorPain1/Kimerith-WindHammer/blob/3c24847d111387fc0b34772b548f74e80089599f/LICENSE) 为依据。上游包元数据中不同的旧许可标记不作为本项目采用宽松许可的依据。

### 移植与适配范围

| 本仓库文件 / 范围 | 上游逻辑及修改 |
| --- | --- |
| `tools/catalog/spell_effects.py` | 移植 `bot/extensions/spells.py` 的效果说明、递归效果树、描述模板及 `bot/database.py` 相关枚举；改为标准库只读 SQLite，中文结构性说明、目标数预编译、未知值保留和有界解析 |
| `tools/catalog/combat.py` | 适配 `bot/database.py` 的 135 属性映射及 `bot/extensions/mobs.py` 的本体 / 全部装备合并、展示与目标属性语义；保留并提示参考实现差异 |
| `lib/kimerith-math.cjs` | 将上游有序 Buff、伤害、穿透、暴击 / 格挡及怪物计算移植为 JavaScript；提供中文逐步报告和输入检查 |
| `tools/catalog/presentation.py` | 适配装备标记 / 限制 / 插槽、法术用途 / 类型、怪物采集 / 显示、宠物普通与竞速天赋、鱼类长度范围等展示语义 |
| `lib/kimerith-controller.cjs`、`lib/kimerith-search.cjs`、`lib/kimerith-views.cjs` | 在 Koishi 中实现固定提交的 15 条公开路由、参数、相近搜索、中文资料与分页；连接现有词典和图卡 |
| `lib/interactions.cjs` 与平台接线 | 为 Koishi 官方适配器实现中文 Slash、独立命令归属、原消息四按钮及 QQ 输入按钮；沿用上游命令形状，替换 Discord.py 运行时 |
| 对应测试与命令契约 | 合成 SQLite、最小参考算法及效果分支夹具，用于比较固定版本的行为；不含完整私有数据库 |

主要修改日期：**2026-11-23**。本版将 Python Discord Bot 的有关能力整合为 Koishi 插件和离线导入器，增加中文词典、双平台 PNG、权限控制、按需分页、资源上限、缺数据说明及原有 Wizard404 扩展。

已修复的参考问题包括空 Buff 字段崩溃、百分比治疗分支遮蔽、变异法术显示 SQL 元组、重复同学派错误合并和彩色条件 / 描述缺引用处理。另一些算术和数据语义为保持固定提交兼容而保留，并在结果中注明。具体行为见[功能对照](docs/reference-parity.md)。本项目的修改不代表上游作者认可或验证，也不宣称与上游项目官方从属。

## wizdb 与游戏资料格式

[MajorPain1/wizdb](https://github.com/MajorPain1/wizdb) 的公开 schema、属性导出与记录规则用于读取用户自己的 `items.db` / `decks.db`。本地导入器只读输入库，保留来源版本、原始 ID、单位和未解释字段。参考格式及实现说明见[数据库导入文档](tools/catalog/README.md)。

公开仓库和由源码生成的公开安装包不包含原始 SQLite、WAD、LANG、汉化全文词典、原版 DDS / TGA / PNG 或字体。`data/*-example.json` 等示例使用合成数据，不作为正式游戏资料。

## Wizard101 文本、汉化与图片

Wizard101 游戏文字和素材归 KingsIsle Entertainment 或相应权利人；社区译文归相应译者或授权主体。部署者应使用自己有权使用的资源。导入、格式转换、中文索引或 PNG 渲染不会给这些内容重新授予 GPL、MIT 或其他代码许可。

用户提供的画像仅在本地 `portraitPath` 中读取；字体使用系统已安装字体或部署者指定文件，不复制系统字体进入源码包。资源更新、资料准确性和素材使用范围与插件代码许可分别处理。

## Wizard404

API 与百科来源：

- [API 文档](https://wizard404.com/api/v1/docs)。
- [OpenAPI](https://www.wizard404.com/api/v1/openapi.json)。
- [关于 Wizard404](https://www.wizard404.com/about)。

查询回答保留来源链接。接口返回的数据按其原有权利和服务条件使用，不因本客户端开源而变成同一许可。上游没有返回的掉落、机制、任务关系不自行生成事实补全。此版本尚未使用有效 Key 完成远程联调，API 名称搜索默认关闭。

本项目是社区工具，不是 KingsIsle、Wizard101 或 Wizard404 的官方产品。

## 运行和开发依赖

- [Koishi](https://github.com/koishijs/koishi)：插件框架及官方 mock。
- [Satori 官方适配器](https://github.com/satorijs/satori)：QQ 与 Discord 编码和平台连接；部署由 Koishi 应用安装。
- [OpenCC-JS](https://github.com/nk2028/opencc-js)：统一简繁检索，展示保留原词典文本。
- [resvg-js](https://github.com/thx/resvg-js)：本地 SVG 到 PNG 渲染。
- [Pillow](https://python-pillow.org/)：部署者另行安装，用于一次性图标转换和相关测试。

各依赖遵循自身分发包内的许可证和版权通知。本项目的 GPL 说明不更改依赖许可。依赖通过包管理器或部署者自己的环境安装，不将其版权声称为本项目原创。
