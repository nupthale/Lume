import { Subject } from 'rxjs';
import { Placement } from '@floating-ui/dom';

import { MentionTypeEnum, PopoverTypeEnum } from './interface';

export const docInit$ = new Subject<{
  doc: Record<string, any>,
  text: string,
}>();

// 文档内容变化
export const docChanged$ = new Subject<{
  doc: Record<string, any>,
  text: string,
}>();

export const showPopover$ = new Subject<{
  // 根据range 计算位置
  range?: [number, number],
  // 根据target 计算位置
  target?: HTMLElement,
  type: PopoverTypeEnum,
  offset?: [number | string, number | string],
  placement?: Placement,
  useMaxHeight?: boolean,
  params?: any,
}>();

export const hidePopover$ = new Subject<{
  type: PopoverTypeEnum,
  delay?: number,
}>();

// doc scroll
export const docScroll$ = new Subject<{ e: Event }>();

// 打开自动补全， baseBlockView里统一监听，触发showPopover
export const autoCompleteOpen$ = new Subject<{
  type: MentionTypeEnum,
  range: {
    from?: number;
    to?: number;
  }
}>();

export const autoCompleteClose$ = new Subject();

export const autoCompleteUp$ = new Subject<{ type: MentionTypeEnum }>();
export const autoCompleteDown$ = new Subject<{ type: MentionTypeEnum }>();
export const autoCompleteFilter$ = new Subject<{ 
  type: MentionTypeEnum,
  filter: string,
}>();
export const autoCompleteEnter$ = new Subject<{
  type: MentionTypeEnum,
}>();

export const selectionChange$ = new Subject<{
  from: number,
  to: number,
}>();