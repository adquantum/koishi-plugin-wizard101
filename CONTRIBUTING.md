# 参与开发

欢迎提交可复现的问题、中文文档修正和代码 Pull Request。0.3 系列程序代码采用 **GPL-3.0-only**，参考 [Kimerith-WindHammer 固定提交 `3c24847d`](https://github.com/MajorPain1/Kimerith-WindHammer/tree/3c24847d111387fc0b34772b548f74e80089599f)。请保留已有作者、来源、许可与修改说明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。早期原创代码的 MIT 通知保留在 `LICENSES/MIT-legacy.txt`，不能用它代表当前整包许可。

## 本地开发

需要 Node.js ≥22、Python ≥3.10。完整测试还需 Pillow 和中文字体，例如 Linux 的 `fonts-noto-cjk`；CI 配置了相应环境。Koishi 及被测官方适配器版本以锁文件为准。

```sh
npm ci
python3 -m pip install Pillow
npm run check
npm test
npm run check:public
```

可通过 `WIZARD101_TEST_PYTHON` 指定 Python 可执行文件。正常机器人运行不需要 Python；数据库与自定义图标工具属于一次性离线准备。0.3.1 的默认小图标随包提供，正常安装无需再次转换。

测试采用合成词典、临时 SQLite、本地 HTTP 服务与内存传输替身，不需要真实 API Key、Bot Token 或 AppSecret。QQ / Discord 兼容测试使用安装的真实官方适配器代码，但拦截外部发送；不要把测试改成自动往真实群聊或服务器发消息。

## 代码分工

| 路径 | 作用 |
| --- | --- |
| `lib/index.cjs` | Koishi 配置、文字命令、权限、生命周期接线 |
| `lib/kimerith-controller.cjs` | 固定上游 15 路由的本地查询和计算编排 |
| `lib/kimerith-search.cjs` / `lib/kimerith-views.cjs` | 参考检索、相近名称、完整资料与分页 |
| `lib/kimerith-math.cjs` | 上游兼容伤害与怪物汇总计算 |
| `lib/interactions.cjs` | Discord 原生注册 / 分页和 QQ 输入按钮 |
| `lib/catalog.cjs` / `lib/locale.cjs` | 有界资料包与词典加载、检索 |
| `lib/api.cjs` | 只读 API、鉴权、限流、缓存及无损大整数 ID |
| `lib/cards.cjs` / `lib/platform.cjs` / `lib/portraits.cjs` | PNG、发送降级与本地原图 |
| `tools/catalog/` | 只读 SQLite、中文效果、135 属性、装备汇总与展示字段 |
| `tools/locale/` / `tools/icons/` | 用户自有文本和自定义图标导入 |
| `assets/icons/` | 已随包提供的 PNG 小图标、清单及素材说明 |

旧 `wiz.estimate` 继续使用简化模型；新 `wiz.calc` / `wiz.mob.calc` 使用固定参考模型。变更时不要复用同名参数却改变评级 / 百分比 / 倍率含义。

## 修改参考实现

涉及上游兼容性时，请同时说明具体提交、函数或分支，指出变化属于保持兼容、确认的修复还是新行为。效果 119 个已说明类型 / 152 个枚举、135 属性映射、目标数、条件递归、完整装备关联和上游算术差异都有明确统计；新增或删除分支后更新对照文档和针对性夹具。

数据单位必须区分百分比、评级、固定值和原始导出值；怪物本体 `stats_scope: base_only` 与 `combat.stats_scope: base_and_equipment` 不可混用。缺表或引用不能默认成游戏属性的零。法术效果和长说明超出预算应明确报错，不截掉尾部并声称完整。ID 使用字符串，尤其法术模板 ID 不等于数据库行号。

原生 Discord 同步只管理本插件登记的命令 ID，要求明确的管理员用户权限，保留同名碰撞预检，不调用整应用批量覆盖。QQ 按钮能力依平台实际权限，不能把模板许可写成完整自定义 Markdown 权限。改动这些路径时补充能验证行为的最小测试。

## 提交问题

请提供插件 / Node / Koishi 版本、适配器版本、触发指令、期望结果及经过脱敏的实际表现。数据库问题说明资料版本、相关 schema 和最小合成记录；不要上传整个游戏库。法术问题尽量给出模板 ID、目标数和未解释字段，避免只用可能多义的名称。

接口问题可用 `tools/probe-api.cjs` 生成报告，分享前再检查内容。不要提交 Key、请求头、交互令牌、完整个人配置、含凭据的 URL 或无关日志。修改 API 适配时附官方字段依据或经授权取得的最小脱敏结构，不把成功 mock 当成远程联调通过。

## 数据、图片与示例

本仓库已收录项目提供的 PNG 小图标，公开范围以 `assets/icons/manifest.json` 和该目录的来源说明为准。维护这套资源时同步清单路径、尺寸、SHA-256 和第三方声明，确认源码与安装包都包含全部引用图片；不要让清单指向开发机的数据目录。图标素材保留原权属，程序代码许可不重新授权这些图片。

完整 WAD、LANG、汉化词典、SQLite、原始 DDS / TGA、完整画像库、字体及未经确认可公开的其他资料不加入公开包。自有运行数据放在 Koishi 应用的 `data/wizard101`。

翻译可通过获得授权的词典维护，再由部署者导入。未知原文和歧义应保留，不为让界面看起来全中文而生成无法校对的法术效果或 Boss 机制。

## Pull Request 说明与验证

先说明用户可见的问题、修改后的行为，再列有意义的验证和剩余限制。普通文档修正无需增加镜像式测试；算法、解析、权限和平台边界应覆盖所改变的风险。需要真实平台验收时明确标注尚未执行，不让自动化携带真实凭据。

提交前运行与改动相关的检查；发布或打包前执行 `npm run check:public`。更新命令或配置时同步 README、使用手册、原生交互文档及示例。0.2 词典 / 图标 / catalog 读取兼容性、旧 API 入口和计算器改名应继续有清晰说明。
