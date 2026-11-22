# API 契约与验证边界

开发依据为 [Wizard404 API 文档](https://wizard404.com/api/v1/docs)、[公开 OpenAPI](https://www.wizard404.com/api/v1/openapi.json)以及 API Key 使用说明。以下是程序当前允许访问的只读路径。

## 路由

| 类别 | 按 ID 查询 | 按名搜索 |
| --- | --- | --- |
| item | `/items/{id}` | `/items` |
| spell | `/spells/{id}` | `/spells/search` |
| mob | `/mobs/{id}` | `/mobs/search` |
| zone | `/zones/{id}` | `/zones/search` |
| npc | `/npcs/{id}` | `/npcs/search` |
| quest | `/quests/{id}` | `/quests/search` |
| talent | `/talents/{id}` | `/talents/search` |
| event | `/events/{id}` | `/events/search` |
| recipe | `/recipes/{id}/preview` | 当前文档未提供，程序不实现 |

基址默认为 `https://wizard404.com/api/v1`。额外读取接口为 `/mobs/{id}/drops`、`/mobs/{id}/cheats`、`/mobs/{id}/deck` 和 `/zones/lookup?object_name=...`。区域内部路径区分大小写。

程序没有开放任意 URL 请求，不调用评论、解锁、同步或构筑写入操作。不能把 GET 一律视为无副作用；文档中事件同步 GET 也不在本插件白名单内。

## 认证与额度

每次请求使用 `Authorization: Bearer <key>` 或 `X-API-Key: <key>`，并发送含工具名称、版本及维护者联系方式的 User-Agent。Key 只在服务端配置。

账号共享额度为每分钟 120 次、突发容量 40；端点限制及实际服务响应优先。程序远程请求默认至少间隔 1,200ms，401 不自动重试，429/503 遵守 Retry-After。多个 Key 不会扩大同一账号额度。

## 尚未完成的远程验证

初始公开版本没有附带使用有效 Key 的成功远程联调记录。一般搜索参数与成功响应 schema 在公开规范中未完整列出，因此：

- `onlineSearchEnabled` 默认关闭。
- `q`、`page`、`limit` 是可修改的候选参数，不是已经证实的通用契约。
- `data`、`items`、`results` 等结构只是显式兼容分支；不识别的结果会报错，不伪装成空列表。
- 数值 ID 从 JSON 解析开始保留精度，超出 JavaScript 安全整数范围的值以十进制字符串传递。
- 空掉落或机制列表表示没有已知记录，不证明游戏中不存在。
- 缺失属性不当作 0，不推算未提供的掉落概率。

请在部署机器运行 `tools/probe-api.cjs`，核对 ID 详情、名称正负对照及分页后再启用对应功能。探测工具不接受命令行密钥，只读取服务端环境变量；报告会脱敏。详见 [使用手册](usage.md)。

## 额外权限

全量 `/bulk/{item_type}` 和法术 `/spells/{id}/card.webp` 等接口有 Wikimaster 角色限制。它们未接入当前插件，不能从普通只读 Key 推断出相应权限。

## 测试证据

`test/api.test.cjs` 和 Koishi 运行时测试使用明确的合成 HTTP 夹具。CI 不配置真实 API Key，也不查询 Wizard404。通过测试证明本地解析、指令交互及异常处理符合实现约定，不代表真实 API schema 已完成适配。
