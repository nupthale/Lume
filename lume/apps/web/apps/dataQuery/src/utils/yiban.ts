import Cookies from 'js-cookie';

// 易办特殊逻辑，如果在易办，每次在易办内打开后端都会设置一个x-yiban-token到cookie里，可以用来判断易办环境
export const yibanToken = Cookies.get('X-YiBan-Token');

// 如果存在WeixinJSBridge， 则证明在易办内
export const isYiban = !!(window as any).WeixinJSBridge;