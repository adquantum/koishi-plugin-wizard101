# 随插件附带的 Wizard101 图标

本目录包含项目维护者提供的 Wizard101 图标资源转换结果：**323 个 PNG 文件、415 个图标键，其中 92 个语义键**。PNG 合计约 1 MiB。它们随 GitHub 源码和 `npm pack` 安装包分发，默认图卡可以直接使用。

`manifest.json` 为每张图片记录文件名、尺寸、SHA-256 及原始资源名称。学派、生命、伤害、抗性、暴击、格挡、魔豆、宠物五维、宝石插槽等图标通过语义键引用；其余资源保留 `asset.*` 键。透明通道来自原始素材，不绘制替代图标。

`iconPath` 留空时，Koishi 插件先尝试应用目录的 `data/wizard101/icons/manifest.json`；不存在或无效时使用本目录。显式设置 `iconPath` 可使用自己的完整图标清单。直接使用 `new CardRenderer({})` 也默认加载本目录，与进程工作目录无关。

原始素材为用户提供的 `Icons.zip` 内 DDS / TGA 文件，使用本仓库 `tools/icons/import.py` 转换为 PNG。未在素材中提供的泪形、别针等图片继续使用文字说明，不用不相关图形替代。中文图卡仍需本机具有中文字体；本目录不包含法术或怪物画像。

## 来源与权属

Wizard101 原版图像素材归 KingsIsle Entertainment 或相应权利人。此处随项目提供用于 Wizard101 中文图鉴展示；格式转换和仓库代码的 GPL-3.0-only 许可不改变这些游戏素材的权属，也不将其重新授予 GPL。项目代码与图像素材的来源分别见根目录 `THIRD_PARTY_NOTICES.md`。
