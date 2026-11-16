import { isNil } from 'lodash-es';

export function formatCount(number) {
    if (isNil(number)) {
        return;
    }

    // 将数字转换为字符串，然后分割成整数部分和小数部分
    const parts = number.toString().split(".");
    // 对整数部分进行格式化
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // 将整数部分和小数部分（如果存在）重新组合
    return parts.join(".");
}