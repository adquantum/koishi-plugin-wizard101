# 内置图标、自定义导入与图片卡片

**0.3.1 已将默认原版小图标放入 GitHub 和安装包。** `assets/icons` 包含 323 个 PNG 及对应的图标索引、语义别名；PNG 合计约 1 MiB。安装插件后即可用这套资源生成带图标的卡片，无需额外准备 `Icons.zip` 或运行转换。插件只读取本地 PNG 和清单，不会从网络下载图标。

## 默认加载与自定义图标

Koishi 的 `iconPath` 留空时，优先兼容应用目录已有且有效的 `data/wizard101/icons/manifest.json`。该旧清单缺失或损坏时读取插件自身的 `assets/icons/manifest.json`；损坏原因仍保留在渲染器状态中。显式填写 `iconPath` 会选择独立自定义清单，加载失败时保留文字标签并报告错误。自定义清单和内置清单分别使用，不合并图标键；用户填写的相对路径以 Koishi 应用根目录为准。内置清单按插件安装目录定位，源码运行和从 `npm pack` 安装均不要求复制图片到当前工作目录。

要替换或补充图标时，再按下面流程转换自己的资源。中文字体仍需由运行环境提供，见“配置中文字体”。

## 1. 可选：转换自己的 DDS / TGA / PNG

仅自定义转换需要 Python 3.10 或更新版本，以及 Pillow。本轮验证使用 Pillow 13.0.0；转换器支持 Pillow 能解码的 DDS、TGA 和 PNG，已验证 DDS DXT1/DXT3/DXT5。

```bash
python -m pip install Pillow
python tools/icons/import.py \
  --input /path/to/Icons.zip \
  --output /absolute/path/to/koishi-app/data/wizard101/icons
```

Windows 可以使用 `py -3` 代替 `python`，含空格的路径需要引号。`--input` 也可以是已解压的目录。输出目录必须不存在或为空；再次导入时请使用新目录并调整配置，避免覆盖已有数据。

输出结构：

```text
icons/
  manifest.json
  png/
    icon_fire-<来源路径摘要>.png
    ...其他实际转换文件
```

转换保留原图颜色、透明度和尺寸，不放大、不自动去黑底。部分珠宝槽原图本身没有透明通道，会保留其深色背景。同名 DDS/TGA 都会转换；语义图标优先选择较大版本，同尺寸时优先 DDS。

工具限制：最多 4096 个条目，ZIP 最大 64 MiB、展开总量最大 128 MiB、单文件最大 8 MiB、单图最大 1024×1024。拒绝路径穿越、绝对路径、符号链接、重复路径、加密 ZIP 和异常压缩比例；不会把 ZIP 中的路径直接解压到文件系统。转换失败不会留下半套输出。

转换后的输出还必须满足渲染器预算：单个 PNG 最大 1 MiB、所有 PNG 合计最大 16 MiB、`manifest.json` 最大 1 MiB、清单最多 2048 个图标键（原文件键与语义别名一起计数）。超过任何一项都明确报错，清理临时输出，不会发布一套渲染器无法读取的成功目录。

## 2. 配置中文字体

图片中同时显示中文与英文，必须有包含中文字形的字体。Linux 推荐安装 Noto Sans CJK，例如 Debian/Ubuntu：

```bash
sudo apt-get install fonts-noto-cjk
```

渲染器会尝试常见的 Noto Sans CJK、文泉驿、Windows 微软雅黑/宋体/微软正黑体与 macOS 苹方路径。若自动查找失败，请在插件配置中填写中文字体的本地 `fontPath`（TTF、OTF 或 TTC）；例如 Windows 的 `C:\Windows\Fonts\msyh.ttc`。字体来自系统或部署者提供，仓库不分发字体文件。

渲染器会检查字体 `cmap` 中的中、文、火、冰、雷等中文字形。它不会仅根据文件名宣称字体可用。缺少中文字体时图片生成功能返回可识别错误，上层应发送原有文字查询结果。

## 3. 代码接口

```js
const { CardRenderer } = require('./lib/cards.cjs')

const renderer = new CardRenderer({
  // 不指定 iconPath 时使用插件内置图标。自定义时可填写：
  // iconPath: '/absolute/path/to/koishi-app/data/wizard101/icons/manifest.json',
  // fontPath: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  maxRows: 28,
  maxImageBytes: 2 * 1024 * 1024,
})

await renderer.initialize() // 可选预热；render() 也会自动初始化
const png = await renderer.render({
  kind: 'item',
  title: '示例装备',
  subtitle: 'Example Equipment · 合成演示数据',
  school: 'fire',
  sections: [{
    title: '属性',
    rows: [
      { label: '生命值', value: '+100', icon: 'stat.health' },
      { label: '火焰伤害', value: '+5%', icon: 'school.fire' },
    ],
  }],
  footer: '合成演示数据，不代表游戏中的真实物品。',
})
// png 是 PNG Buffer，可交给 Koishi 的 h.image(png, 'image/png')。
console.log(renderer.status())
renderer.dispose()
```

`renderTextCard(text, options)` 可以将已有纯文本结果转换成同风格卡片。`render()` 会自动换行、限制字段长度、行数与高度；过长内容在图片中显示省略提示，完整内容仍应通过文字分页获取。单实例只同时进行一次渲染，忙碌或失效时抛出 `code === 'WIZ_CARD_UNAVAILABLE'` 的错误；调用方保留文字回退即可。

`status()` 返回初始化、中文字体、可用图标键数量和脱敏原因，不返回服务器路径。默认使用随包图标；某个语义键缺图或显式自定义清单加载失败时保留文字标签。缺字体则停止生成图片。仅支持本地清单引用的 PNG：拒绝越界路径、远程 URL、伪装成 PNG 的 SVG、超大尺寸和不匹配的 SHA-256。

## 4. 语义图标键

| 图标键 | 用途 |
|---|---|
| `school.fire/ice/storm/myth/life/death/balance` | 七大学派 |
| `school.sun/moon/star/shadow/universal` | 日、月、星、暗影与全学派 |
| `pip.normal/power/shadow` | 普通、超级与暗影魔豆 |
| `pip.fire/ice/storm/myth/life/death/balance` | 学派魔豆 |
| `stat.health/mana/energy` | 生命、法力、精力 |
| `stat.damage/resist/accuracy/critical/block/pierce` | 伤害、抗性、命中、暴击、格挡、穿透 |
| `stat.archmastery/pip_conversion/power_pip` | 精通、魔豆转换与超级魔豆率 |
| `stat.heal/incoming/outgoing` | 治疗、受疗、治疗加成 |
| `spell.blade/shield/trap/weakness/aura/global/dot/hot` | 刃、盾、陷阱、虚弱、光环、全场、持续伤害/治疗 |
| `socket.circle/square/triangle/octagon` | 宝石槽；追加 `.locked` 为锁定版本 |
| `pet.strength/intellect/agility/will/power` | 宠物五维 |
| `asset.<原文件名小写>.<dds或tga或png>` | 其他已转换图标，实际键以清单为准 |

缺少某张原图时，对应语义键不会生成。图标包并不保证包含装备槽、物品外观、法术插画或宠物头像；卡片不会用不相关图标冒充这些图片。

随包公开的资源限于 `assets/icons` 中的 PNG 和清单，并保留 Wizard101 / KingsIsle Entertainment 或相应权利人的素材归属。自定义图标版本、原始 DDS / TGA、画像和用户字体放在自己的 Koishi 数据目录。程序代码许可不为这些素材重新授予 GPL 或 MIT 权限，详见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。
