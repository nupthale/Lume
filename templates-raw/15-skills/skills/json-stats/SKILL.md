---
name: json-stats
description: 计算一组数字的统计量（均值、中位数、标准差、极差）。当用户要求统计、分析一组数字数据时使用。
---

# 数字统计

本技能没有独立脚本文件，代码内嵌在下面。执行方式是「两步中转」：
先把代码保存成文件，再用 node 执行——你只负责中继文本，
真正的执行永远发生在工具层。

## 步骤

1. 调 write_file，把「脚本」一节的代码【原样】保存为 output/stats.mjs
2. 调 run_command 执行（数字数组用单引号包成 JSON，数组内不能出现单引号）：

```bash
node output/stats.mjs '[12, 40, 8]'
```

3. 脚本在 stdout 输出一行 JSON 结果，把它整理成易读的形式报告给用户

## 脚本

```js
const nums = JSON.parse(process.argv[2] ?? '[]');
if (!Array.isArray(nums) || nums.length === 0) {
  console.error("usage: node stats.mjs '[1,2,3]'");
  process.exit(1);
}
const sorted = [...nums].sort((a, b) => a - b);
const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
const mid = Math.floor(sorted.length / 2);
console.log(JSON.stringify({
  count: nums.length,
  mean: +mean.toFixed(2),
  median: sorted.length % 2 ? sorted[mid] : +((sorted[mid - 1] + sorted[mid]) / 2).toFixed(2),
  stdev: +Math.sqrt(nums.reduce((s, x) => s + (x - mean) ** 2, 0) / nums.length).toFixed(2),
  range: sorted[sorted.length - 1] - sorted[0],
}));
```
