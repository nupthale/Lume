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