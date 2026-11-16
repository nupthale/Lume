import dayjs from 'dayjs';

// 显示相对时间
export const formatDiffTime = (time: string) => {
    const now = dayjs()
    const target = dayjs(time);
  
    if (now.diff(target, 'minute') < 1) {
      return '刚刚';
    } if (now.diff(target, 'hour') < 1) {
      // 1小时内，显示"xx分钟前"
      return `${now.diff(target, 'minute')}分钟前`;
    } else if (now.isSame(target, 'day')) {
      // 今天内，显示"今天 HH:mm"
      return `今天 ${target.format('HH:mm')}`
    } else if (now.isSame(target, 'year'))  {
      // 今年内的日期
      return target.format('MM月DD日 HH:mm')
    } else {
      // 今年内的日期
      return target.format('YYYY年MM月DD日 HH:mm')
    }
}