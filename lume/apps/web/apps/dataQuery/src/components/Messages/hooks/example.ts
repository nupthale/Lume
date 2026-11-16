export const exampleMdText = `# 这是 Markdown 标题
*alpha* _bravo_

![alpha](https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/static/image/logo-icon-white-bg.72df0b1a.png "bravo")

[带解发手](https://example.com "bravo")

| asdfsdaasdfsda | asdfsda  |  asdfsda |  asdfsdaasdfsda  |
| - | :- | -: | :-: |
| 1 | 2 | 3 | 4 |

1. foo
2. sdf

~~alpha~~

\`\`\`vis-chart
{"type":"pie","data":[{"id":"id0","values":[{"type":"oxygen","value":"46.60"},{"type":"silicon","value":"27.72"},{"type":"aluminum","value":"8.13"},{"type":"iron","value":"5"},{"type":"calcium","value":"3.63"},{"type":"sodium","value":"2.83"},{"type":"potassium","value":"2.59"},{"type":"others","value":"3.5"}]}],"outerRadius":0.8,"valueField":"value","categoryField":"type","title":{"visible":true,"text":"Surface element content statistics"},"legends":{"visible":true,"orient":"left"},"label":{"visible":true}}
\`\`\`

\`\`\`javascript
// 直接换行，保留格式
const str = 第一行
第二行
第三行（支持变量：${new Date().getFullYear()}）;

console.log(str);
// 输出结果（保留换行）：
// 第一行
// 第二行
// 第三行（支持变量：2025）

\`\`\`



## 二级标题
这是第一段文本，后面跟一个空行（Markdown 中空行分隔段落）

这是第二段文本，包含换行：
- 列表项 1
- 列表项 2
- 嵌套列表项（前面有缩进）

> 引用内容
> 引用的第二行（Markdown 中引用换行需加 > 或续行）

**粗体文本** + 普通文本，换行后继续写...
`;