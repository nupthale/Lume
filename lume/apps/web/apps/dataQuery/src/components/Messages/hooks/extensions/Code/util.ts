export function isJsonString(str) {
    // 先判断是不是字符串类型
    if (typeof str !== 'string') {
      return false;
    }
  
    try {
      // 尝试解析
      const result = JSON.parse(str);
      // 进一步过滤：如果解析后是对象/数组/基本类型，才是合法 JSON
      return typeof result === 'object' && result !== null;
    } catch (e) {
      // 解析失败 → 不是 JSON 字符串
      return false;
    }
  }

  export function parseConfig(str) {
    if (!str) return {};

    try {
      return JSON.parse(str);
    } catch (e) {
      try {
        return new Function(`return ${str}`)();
      } catch (e2) {
        return {};
      }
    }
  }