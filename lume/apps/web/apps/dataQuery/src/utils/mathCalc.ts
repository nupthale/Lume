/**
 * 精确加法
 */
export function add(num1: number, num2: number): number {
    let r1, r2;
    try {
        r1 = num1.toString().split('.')[1].length;
    } catch (e) {
        r1 = 0;
    }
    try {
        r2 = num2.toString().split('.')[1].length;
    } catch (e) {
        r2 = 0;
    }
    const m = Math.pow(10, Math.max(r1, r2));
    return divide((multiply(num1, m) + multiply(num2, m)), m);
}

/**
 * 精确减法
 */
export function subtract(num1: number, num2: number): number {
    let r1, r2;
    try {
        r1 = num1.toString().split('.')[1].length;
    } catch (e) {
        r1 = 0;
    }
    try {
        r2 = num2.toString().split('.')[1].length;
    } catch (e) {
        r2 = 0;
    }
    const m = Math.pow(10, Math.max(r1, r2));
    return divide((multiply(num1, m) - multiply(num2, m)), m);
}

/**
 * 精确乘法
 */
export function multiply(num1: number, num2: number): number {
    let m = 0;
    const s1 = num1.toString();
    const s2 = num2.toString();
    try {
        m += s1.split('.')[1].length;
    } catch (e) { }
    try {
        m += s2.split('.')[1].length;
    } catch (e) { }
    return (Number(s1.replace('.', '')) * Number(s2.replace('.', ''))) / Math.pow(10, m);
}

/**
 * 精确除法
 */
export function divide(numerator, denominator): number {
    if (denominator === 0) {
        throw new Error("Denominator must be greater than zero");
    }

    // 将小数转换为整数
    const numeratorStr = numerator.toString();
    const denominatorStr = denominator.toString();
    
    const numeratorDecimals = numeratorStr.includes('.') ? numeratorStr.split('.')[1].length : 0;
    const denominatorDecimals = denominatorStr.includes('.') ? denominatorStr.split('.')[1].length : 0;

    const factor = Math.pow(10, Math.max(numeratorDecimals, denominatorDecimals));

    // 进行整数除法
    const result = (numerator * factor) / (denominator * factor);

    return result;
}