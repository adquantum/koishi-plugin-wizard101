# 本地词典与游戏资料

本目录的 `locale-example.json` 包含两个合成词条，不是游戏数据。该示例不会自动加载；测试格式时可以显式将 `localePath` 指向它。

中文游戏查询需要部署者从其有权使用的 WAD/LANG 生成自己的词典：

```bash
node tools/locale/import.cjs --input /path/to/Locale_en-US-Root.wad --output /path/to/koishi/data/wizard101/locale-zh.json.gz
```

插件默认从 Koishi 工作目录下的 `data/wizard101/locale-zh.json.gz` 读取。也可以把 `localePath` 设为另一个 JSON / JSON.gz 的绝对路径。

生成的词典默认被 Git 忽略，也不在 npm 包白名单中。完整格式见 [导入器文档](../tools/locale/README.md)。

`catalog-example.json` 是人工合成的物品、宠物、鱼类和上限资料包，字段说明见[资料导入](../tools/catalog/README.md)。它不会自动加载，不能用作真实配装/百科依据。仅测试格式时显式设置 `catalogPath`。

自己的游戏资料默认放 `data/wizard101/catalog.json.gz`。本目录只收录上述合成示例与说明，不包含完整游戏数据库或汉化词典。

0.3.1 起，默认原版小图标随插件放在 `assets/icons`，不需要复制到本目录。`iconPath` 留空时兼容已有的 `data/wizard101/icons/manifest.json`；该旧清单缺失或损坏时加载包内图标。自定义图标、法术 / 怪物画像和字体仍可分别配置，详见[图标说明](../tools/icons/README.md)。
