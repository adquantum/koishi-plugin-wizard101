# 与 Kimerith-WindHammer 的功能对照

参考：[MajorPain1/Kimerith-WindHammer](https://github.com/MajorPain1/Kimerith-WindHammer)，核对提交 `3c24847d111387fc0b34772b548f74e80089599f`。本插件版本 0.2.0。

参考项目是 Python Discord Bot，依赖本地 `items.db`、`decks.db` 及游戏图片。本插件保留 Koishi、中文词典和 Wizard404，并增加本地资料与双端 PNG。

| 范围 | 参考项目 | 本插件 0.2.0 |
| --- | --- | --- |
| 物品 find/list | 名称、Object、ID、学派/种类/等级 | `item/gear/list` 本地同类检索与筛选 |
| 法术 find/list | 基本参数与底层效果树 | `spell/list` 的已有字段与描述；未移植完整效果树解释器 |
| 怪物 find/list/deck | 基础属性、AI、牌组 | `mob/list/deck` 本地或 API；完整装备总属性尚未汇总 |
| 宠物 find/list | 五维、蛋、天赋、卡、Wow、专属 | `pet/list`，需要本地数据库；不猜未标分类的普通/竞速天赋 |
| 鱼类 find/list | 学派/阶级/哨兵与参数 | `fish/list`，同类本地筛选 |
| statcaps | 学派等级查表、十级向下取整 | 精确等级查表，缺记录时列出已收录等级 |
| calc | 参考实现的暴击/评级/buff公式 | 独立单段估算，手动暴击倍率，逐步说明假设 |
| mob calc | 汇总怪物与装备再算 | 仅使用明确百分比抗性；缺完整值时要求手动输入 |
| 图示 | Discord Embed、emoji、缩略图 | 原版图标 PNG 资料卡，两端共用 |
| 分页 | 四按钮、编辑原消息、发起者隔离 | first/prev/next/last/pick 与 page；用户/频道隔离 |
| 平台 | Discord | QQ 官方群/单聊、QQ频道、Discord 普通文字指令 |
| Wiki 扩展 | 未见完整掉落/配方/任务/区域命令 | 保留 Wizard404 适配，真实Key联调待完成 |

## 数据条件

WAD / LANG 本地化文件包含名称、对话和界面文字；Icons.zip 包含小图标。它们不能补齐宠物天赋池、鱼类参数、装备数值和等级上限。需要自己的 [wizdb](https://github.com/MajorPain1/wizdb) 导出或标准化 JSON 资料包，使用[只读导入器](../tools/catalog/README.md)。

当前自动化使用合成数据库验证公开 schema，尚未拿到真实 items.db 做全量导入验收。未知属性明确标记；不上网下载游戏数据库，不把合成样例作为正式游戏记录。

## 当前交互差异

同名检索列候选，不自动认定模糊分数最高的对象。API 未确认的过滤参数不会猜测发送，因此复杂组合筛选用于本地资料包。

原生 Discord Slash Commands、按钮编辑、QQ Markdown 模板与后台菜单注册尚未实现。玩家两端使用同一套 `wiz` 指令；详细发送、被动回复与附件配置见[平台文档](platforms.md)。

## 参考与授权

参考仓库根 LICENSE 为 GPL-3.0，包元数据又写 ISC，存在不一致。本项目独立实现同类功能，不移植参考源码。公开数据库字段、文件格式与通用协议用于兼容设计；用户的游戏资源也不因导入而获得 MIT 许可。

核对入口：[命令帮助](https://github.com/MajorPain1/Kimerith-WindHammer/blob/main/bot/extensions/help.py)、[分页实现](https://github.com/MajorPain1/Kimerith-WindHammer/blob/main/bot/menus/items.py)、[wizdb schema](https://github.com/MajorPain1/wizdb/blob/main/wizdb/db.py)。
