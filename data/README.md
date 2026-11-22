# 本地词典与游戏资料

公开仓库只包含 `locale-example.json`，其中两个词条完全为合成示例，不是游戏数据。该示例不会自动加载；测试格式时可以显式将 `localePath` 指向它。

中文游戏查询需要部署者从其有权使用的 WAD/LANG 生成自己的词典：

```bash
node tools/locale/import.cjs --input /path/to/Locale_en-US-Root.wad --output /path/to/koishi/data/wizard101/locale-zh.json.gz
```

插件默认从 Koishi 工作目录下的 `data/wizard101/locale-zh.json.gz` 读取。也可以把 `localePath` 设为另一个 JSON / JSON.gz 的绝对路径。

生成的词典默认被 Git 忽略，也不在 npm 包白名单中。完整格式见 [导入器文档](../tools/locale/README.md)。

`catalog-example.json` 是人工合成的物品、宠物、鱼类和上限资料包，字段说明见[资料导入](../tools/catalog/README.md)。它不会自动加载，不能用作真实配装/百科依据。仅测试格式时显式设置 `catalogPath`。

自己的游戏资料默认放 `data/wizard101/catalog.json.gz`，图标放 `data/wizard101/icons/manifest.json` 及其PNG。公开仓库只保留上述合成示例与说明，不包含完整游戏数据和原版图片。
