# lanzhou_navy_gold（澜舟深蓝金） - 设计规范

> 来源：自 `projects/test.pptx`（澜舟科技 2026—2028 战略规划 Deck）提取的可复用 Deck 模板。

## 一、模板概述

- **模板名称**: lanzhou_navy_gold（澜舟深蓝金）
- **适用场景**: 企业战略规划、年度发布会、董事会汇报、高端商务路演
- **设计调性**: 深蓝夜空 × 金色点缀，沉稳高端、科技感与仪式感并重；宋体大标题营造庄重叙事感

## 二、画布规范

- 格式: PPT 16:9
- 尺寸: 1280×720
- viewBox: `0 0 1280 720`

## 三、配色方案

| 角色 | HEX | 用途 |
|------|------|------|
| 深夜蓝（暗页底） | `#141B45` | 封面/章节/结束页背景罩层 |
| 主导深蓝 | `#1E2761` | 亮页标题、强调文本、圆形装饰 |
| 金色（强调） | `#C9A227` | 方块装饰、编号、眉题、描边 |
| 浅蓝文本 | `#CADCFC` / `#D8E2F8` | 暗页副标题、英文、正文 |
| 淡蓝灰文本 | `#AEBBD8` / `#B9C4DC` | 暗页次要信息、页码 |
| 正文灰 | `#5A6474` | 亮页正文 |
| 次要灰 | `#9AA3B5` | 英文小标、页脚、页码 |
| 亮页背景 | `#F6F8FC` | 目录/内容页底色 |
| 卡片白 | `#FFFFFF` | 圆角卡片 |
| 浅蓝填充 | `#D9E1F2` / `#EDF2FC` | 胶囊、洞察条 |

## 四、排版体系

| 层级 | 字体 | 字号(px) | 颜色 |
|------|------|----------|------|
| 封面主标题 | Songti SC, serif | 59 bold | #FFFFFF |
| 章节编号 | Songti SC, serif | 101 bold | #C9A227 |
| 章节/亮页标题 | Songti SC, serif | 36-45 bold | #FFFFFF / #1E2761 |
| 眉题/英文标 | PingFang SC, sans-serif | 15-20 bold | #C9A227 |
| 正文 | PingFang SC, sans-serif | 16-17 | #5A6474 / #CADCFC |
| 次要信息 | PingFang SC, sans-serif | 11-14 | #9AA3B5 / #AEBBD8 |

字体栈：
- 展示字体: `Songti SC, STSong, serif`
- 正文字体: `PingFang SC, Microsoft YaHei, sans-serif`

## 五、页面结构

- **暗页（封面/章节/结束）**: 实景夜景图 + `#141B45` 半透明罩层（fill-opacity 0.4-0.8）；左上角「金色方块 + 品牌名」固定锚点；右下角页码
- **亮页（目录/内容）**: `#F6F8FC` 底 + 白色圆角卡片（rx=12）；左上「金色方块 + 金色眉题」；底部页脚左品牌、右页码
- **装饰语言**: 8-17px 金色实心方块（品牌符号）、金色描边胶囊、浅蓝圆角面板

## 六、页面类型

| 文件 | 结构 |
|------|------|
| `01_cover.svg` | 居中：金色方块 → 眉题 → 大标题 → 副标题；左下作者/日期；右下保密标签 |
| `02_toc.svg` | 左上标题+英文；3 张白色卡片（金色大编号+中文标题+英文+描述+金色方块分隔） |
| `02_chapter.svg` | 左半暗面板：超大金色编号+白色标题+英文+3 个浅蓝金边胶囊 |
| `03_content.svg` | 页眉（眉题+大标题）+ 白色内容区 + 底部洞察条 + 页脚 |
| `04_ending.svg` | 居中：金色方块 → 感谢语 → 英文 → 口号；底部联系信息 |

## 七、布局模式（推荐）

- 内容页优先：左图右文 / 三卡并列 / 图表+KPI 侧栏（参考源 Deck 第 4、7、10 页）
- KPI 数字用 Songti SC 金色大号（27pt→36px 以上），单位用深蓝小号
- 关键结论用底部「洞察条」：`#EDF2FC` 圆角 + 金色方块 + 金色「洞察」标签

## 八、间距规范

- 页边距: 左右 48px，顶部锚点 y=61-70，页脚 y=687
- 卡片间距: 24px；卡片内边距: 24-32px
- 圆角: 卡片 rx=12，胶囊 rx=24，洞察条 rx=10

## 九、SVG 技术约束

- viewBox 必须为 `0 0 1280 720`；背景用 `<rect>` 或 `<image>`
- 禁用: clipPath / mask / `<style>` / class / id / 外部 CSS / foreignObject / textPath / @font-face / animate* / script / marker / iframe
- PPT 兼容: 不用 rgba()，透明用 `fill-opacity`；不用 `<g opacity>`
- 图片: `preserveAspectRatio="xMidYMid slice"`，水印已裁切

## 十、占位符规范

| 占位符 | 用途 | 页面 |
|--------|------|------|
| `{{BRAND}}` | 品牌/机构名 | 封面/章节/结束 |
| `{{EVENT_TAG}}` | 顶部右侧活动标签 | 封面 |
| `{{EYEBROW}}` | 眉题（金色） | 封面 |
| `{{TITLE}}` / `{{SUBTITLE}}` | 主/副标题 | 封面 |
| `{{AUTHOR}}` / `{{DATE}}` | 汇报人/日期 | 封面 |
| `{{CONFIDENTIAL}}` | 保密标签 | 封面 |
| `{{TOC_TITLE}}` / `{{TOC_TITLE_EN}}` | 目录标题/英文 | 目录 |
| `{{TOC_NUM_n}}` / `{{TOC_ITEM_n_TITLE}}` / `{{TOC_ITEM_n_EN}}` / `{{TOC_ITEM_n_DESC}}` | 目录项（n=1..3） | 目录 |
| `{{CHAPTER_NUM}}` / `{{CHAPTER_TITLE}}` / `{{CHAPTER_TITLE_EN}}` | 章节编号/标题/英文 | 章节 |
| `{{CHAPTER_TAG_1..3}}` | 章节子主题胶囊 | 章节 |
| `{{SECTION_NAME}}` / `{{PAGE_TITLE}}` | 眉题/页面标题 | 内容 |
| `{{CONTENT_AREA}}` | 内容区（AI 自由布局） | 内容 |
| `{{KEY_MESSAGE}}` | 洞察条核心观点 | 内容 |
| `{{FOOTER_BRAND}}` | 页脚品牌行 | 内容 |
| `{{PAGE_NUM}}` | 页码 | 全部 |
| `{{THANK_YOU}}` / `{{THANK_YOU_EN}}` | 感谢语/英文 | 结束 |
| `{{TAGLINE}}` / `{{CONTACT_INFO}}` | 口号/联系方式 | 结束 |

## 附：图片资产

| 文件 | 说明 |
|------|------|
| `cover_bg.jpg` | 封面背景 - 仰视楼宇夜景（2560×1280，已裁水印） |
| `chapter_bg.jpg` | 章节背景 - 发光上升趋势线 |
| `ending_bg.jpg` | 结束背景 - 城市夜景天际线 |
