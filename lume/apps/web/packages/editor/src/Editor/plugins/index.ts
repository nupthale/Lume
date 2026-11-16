import { Schema } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { dropCursor } from 'prosemirror-dropcursor';
import { search } from 'prosemirror-search';

import { coreKeymapPlugin, baseKeymapPlugin } from './core/keymap';
import { linkDecorationPlugin } from './core/link';
import { history } from './core/history';
import { copyPastePlugin } from './core/copyPaste';
import { docUpdatedPlugin } from './core/docUpdated';
import './core/fill';
import { bubbleMenuPlugin } from './core/bubbleMenu';
import { selectBlockPlugin } from './core/selectBlock';
import { selectionChangePlugin } from './core/selectionChange';
import { autocompletePlugins } from './core/autocomplete';

import { title } from './nodes/title/plugin';
import { textBlock } from './nodes/textBlock/plugin';
import { header } from './nodes/header/plugin/index';

import { highlight } from './nodes/highlight/plugin';
import { quote } from './nodes/quote/plugin';

import { list } from './nodes/list/plugin/index';
import { tablePlugin } from './nodes/table/plugin';
import { image } from './nodes/image/plugin';
import { video } from './nodes/video/plugin';
import { iframe } from './nodes/iframe/plugin';
import { divider } from './nodes/divider/plugin';

import { mentionBranch } from './nodes/mentionBranch/plugin';
import { mentionIndex } from './nodes/mentionIndex/plugin';
import { query } from './nodes/query/plugin';

import { coder } from './nodes/coder/plugin/index';
import { columns } from './nodes/columns/plugin/index';

import { createMarkdownInputRules } from './markdown/inputRules';

// 导入更多插件...

// 集中注册所有插件
export function plugins(schema: Schema): Plugin[] {
  const base = [
    // 优先级最高，必须在最前面
    ...selectBlockPlugin(),
    ...selectionChangePlugin(),
    ...history(),
    ...docUpdatedPlugin(),
    ...autocompletePlugins(),
  
    ...query(schema),
    ...highlight(schema),
    ...quote(schema),
    ...coder(),
    ...title(schema),
    ...tablePlugin(),
    ...textBlock(schema),
    ...header(schema),
    createMarkdownInputRules(schema),
    
    ...list(),
    ...image(schema),
    ...video(schema),
    ...iframe(schema),
    ...divider(schema),
    
    
    ...columns(),
    ...mentionBranch(),
    ...mentionIndex(),

    // 优先级最低
    ...bubbleMenuPlugin(),
    ...coreKeymapPlugin(),
    ...baseKeymapPlugin(),
    ...copyPastePlugin(),
    linkDecorationPlugin,

    // 查找和替换
    search(),

    // 拖拽用的光标
    dropCursor({
      class: 'doc-drop-cursor',
      color: '#1456f0',
      width: 2,
    }),
  ];
  
  return base;
}