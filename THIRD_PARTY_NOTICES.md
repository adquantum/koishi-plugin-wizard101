# 第三方数据与来源

## 插件代码

本项目程序代码使用 MIT 许可证，详见 [LICENSE](LICENSE)。该许可证不改变第三方游戏数据、社区译文、依赖包和 API 数据的权利归属。

## 本地化数据

公开仓库及其公开 npm 包不附带 Wizard101 WAD、LANG、汉化全文词典、字体或贴图。`data/locale-example.json` 只有合成的格式示例。

部署者可以使用导入工具处理自己有权使用的数据。Wizard101 游戏文字和素材归 KingsIsle Entertainment 或相应权利人；社区译文归相应译者或授权主体。导入工具不会为这些内容重新授予 MIT 权限。

## Wizard404

API 和百科来源：

- https://wizard404.com/api/v1/docs
- https://www.wizard404.com/api/v1/openapi.json
- https://www.wizard404.com/about

回答保留来源链接。上游未收录的掉落、机制和任务关系不作事实补全。本项目不是 Wizard404 或 KingsIsle 的官方产品。

## 图标、字体与本地游戏资料

用户自行提供的原版 DDS/TGA/PNG、SQLite游戏数据和转换后的资源不随仓库或npm包分发。图标转换不改变其权利归属。字体使用系统已安装字体或部署者提供的文件；不复制或重新授权系统字体。

本地资料兼容 [wizdb](https://github.com/MajorPain1/wizdb) 的公开数据库schema；功能参考 [Kimerith-WindHammer](https://github.com/MajorPain1/Kimerith-WindHammer)，不移植该机器人源码。其根LICENSE与包元数据存在差异，因此本项目仅独立实现同类能力。

PNG渲染依赖 [resvg-js](https://github.com/thx/resvg-js)，遵循其MIT许可。一次性图标转换使用 [Pillow](https://python-pillow.org/)，由部署者另行安装。QQ和Discord官方适配器作为开发测试依赖使用，部署时由Koishi应用安装。

## 依赖

- [Koishi](https://github.com/koishijs/koishi)
- [OpenCC-JS](https://github.com/nk2028/opencc-js)

依赖通过 npm 安装，并遵循各自包内许可证。OpenCC-JS 用于统一简繁检索形式，显示译文保持自有词典中的原文。
