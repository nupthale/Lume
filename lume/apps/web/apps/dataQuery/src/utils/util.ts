import * as MathCalc from '@/utils/mathCalc';

export function formatDateToNumber(value) {
    if (typeof value === 'object') {
      const dateObj = new Date(value);
      let month: any = dateObj.getMonth() - 0 + 1;
      if (month < 10) {
        month = '0' + month;
      }
      let day: any = dateObj.getDate();
      if (day < 10) {
        day = '0' + day;
      }
      return dateObj.getFullYear() + '' + month + '' + day;
    } else if (typeof value === 'string' && value.length === 10) {
      return value.replace(/\-/g, '');
    }
    return value;
}

export function formatDateToString(value) {
    if (typeof value === 'string' || typeof value === 'number') {
      value = value + '';
      if (value.length === 8) {
        return value.substr(0, 4) + '-' + value.substr(4, 2) + '-' + value.substr(6, 2);
      }
    } else if (typeof value === 'object') {
      const dateObj = new Date(value);
      let month: any = dateObj.getMonth() - 0 + 1;
      if (month < 10) {
        month = '0' + month;
      }
      let day: any = dateObj.getDate();
      if (day < 10) {
        day = '0' + day;
      }
      return dateObj.getFullYear() + '-' + month + '-' + day;
    }
    return value;
  }

/**
 * 时间格式化
 * @param value
 * @param fmt
 * @returns {*}
 */
export function formatDate(value, fmt = 'yyyy-MM-dd') {
  if (!value) return null;
  value = formatDateToNumber(value);
  let regPos = /^\d+(\.\d+)?$/;
  if (regPos.test(value)) {
    //如果是数字
    value = formatDateToString(value);
    let getDate = new Date(value);
    let o = {
      'M+': getDate.getMonth() + 1,
      'd+': getDate.getDate(),
      'h+': getDate.getHours(),
      'm+': getDate.getMinutes(),
      's+': getDate.getSeconds(),
      'q+': Math.floor((getDate.getMonth() + 3) / 3),
      S: getDate.getMilliseconds(),
    };
    if (/(y+)/.test(fmt)) {
      fmt = fmt.replace(RegExp.$1, (getDate.getFullYear() + '').substr(4 - RegExp.$1.length));
    }
    for (let k in o) {
      if (new RegExp('(' + k + ')').test(fmt)) {
        fmt = fmt.replace(RegExp.$1, RegExp.$1.length === 1 ? o[k] : ('00' + o[k]).substr(('' + o[k]).length));
      }
    }
    return fmt;
  } else {
    //TODO
    value = value.trim();
    return value.substr(0, fmt.length);
  }
}

//万元、亿元数据
//decimalPlaces-保留小数位数
//divisorDigit-除数位数，万-4；亿-8
//unSplit - 不千分位分隔，默认分隔
export function formatAmount(value, withUnit = false, decimalPlaces = 2, divisorDigit = 0, unSplit = false) {
  if (!value && value !== 0) return '-';
  let divisor = Math.pow(10, divisorDigit || 0); //除数
  // let place = Math.pow(10, decimalPlaces || 0)//小数位数
  let val: any = (value / divisor).toFixed(decimalPlaces);
  let valArray = String(val).split('.');
  if (valArray[1] === '000') {
    val = parseFloat(val);
  }
  let unitText = '';
  if (withUnit) {
    unitText = '元';
    if (divisorDigit == 4) unitText = '万';
    if (divisorDigit == 8) unitText = '亿';
  }
  if (unSplit) {
    return Number(val) + unitText;
  }
  let arr = val.toString().split('.');
  return arr[0].replace(/(\d)(?=(?:\d{3})+$)/g, '$1,') + (arr.length > 1 ? '.' + arr[1] : '') + unitText; //将整数部分逢三一断
}

export function splitAmount(value) {
  if (!value && value !== 0) return;
  let arr = value.toString().split('.');

  return arr[0].replace(/(\d)(?=(?:\d{3})+$)/g, '$1,') + (arr.length > 1 ? '.' + arr[1] : '');
}

//百分数转换
//decimalPlaces-保留小数位数
export function formatPercent(value, withUnit = false, decimalPlaces = 2, unSplit = false) {
  if (!value && value !== 0) return '';
  if (value == 0) return withUnit ? '0%' : 0;
  let val = MathCalc.multiply(value, 100).toFixed(decimalPlaces);
  if (unSplit) {
    return Number(val) + (withUnit ? '%' : '');
  }
  let arr = val.toString().split('.');
  return arr[0].replace(/(\d)(?=(?:\d{3})+$)/g, '$1,') + (arr.length > 1 ? '.' + arr[1] : '') + (withUnit ? '%' : ''); //将整数部分逢三一断
}

export function parseConfigWithFunctions(configStr) {
  // 第一步：解析外层对象
  const rootObj = new Function(`return ${configStr}`)();

  // 递归遍历所有节点，把函数字符串转为真实函数
  function traverse(obj) {
    // 跳过基础类型
    if (obj === null || typeof obj !== 'object') return obj;
    // 数组单独遍历
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => {
        obj[idx] = traverse(item);
      });
      return obj;
    }
    // 对象遍历每个属性
    for (const k in obj) {
      const rawVal = obj[k];
      // 判断当前值是不是函数字符串
      if (typeof rawVal === 'string') {
        // 匹配两种格式：箭头函数 / function 函数，忽略首尾空格
        // function函数
        const functionRegex = /function\s*([a-zA-Z_$][\w$]*\s*)?\([^)]*\)\s*\{[\s\S]*?\}/g;
        // 箭头函数
        const arrowRegex = /(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>\s*(\{[\s\S]*?\}|[^,;\n]+)/g;
        // 对象方法
        const methodRegex = /(?:async\s+)?\*?[a-zA-Z_$][\w$]*\s*\([^)]*\)\s*\{[\s\S]*?\}/g;

        const funcReg = /^\s*(function\s*\(|[a-zA-Z_$][\w$]*\s*=>|\([^)]*\)\s*=>)/;

        if (functionRegex.test(rawVal) || arrowRegex.test(rawVal) || methodRegex.test(rawVal) || funcReg.test(rawVal)) {
          // try {
          //   // 把函数字符串转为可执行函数
          //   obj[k] = new Function(`return ${rawVal}`)();
          // } catch (err) {
          //   console.warn(`字段${k}函数转换失败`, rawVal, err);
          // }

          // 把函数字符串转为可执行函数
          obj[k] = new Function(`return ${rawVal}`)();
        }
      } else {
        // 嵌套对象/数组递归处理
        obj[k] = traverse(rawVal);
      }
    }
    return obj;
  }

  return traverse(rootObj);
}