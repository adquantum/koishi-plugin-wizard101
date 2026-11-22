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

## 依赖

- [Koishi](https://github.com/koishijs/koishi)
- [OpenCC-JS](https://github.com/nk2028/opencc-js)

依赖通过 npm 安装，并遵循各自包内许可证。OpenCC-JS 用于统一简繁检索形式，显示译文保持自有词典中的原文。
