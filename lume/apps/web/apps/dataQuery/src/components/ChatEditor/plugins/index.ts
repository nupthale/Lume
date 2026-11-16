import { Plugin } from 'prosemirror-state';

import { baseKeymapPlugin } from './core/keymap';
import { history } from './core/history';
import { docUpdatedPlugin } from './core/docUpdated';
import { placeholderPlugin } from './core/placeholder';
import { selectionChangePlugin } from './core/selectionChange';

import { autocompletePlugins } from './core/autocomplete';
import { mentionBranch } from './nodes/mentionBranch/plugin';
import { mentionIndex } from './nodes/mentionIndex/plugin';
import { slot } from './nodes/slot/plugin';

// 导入更多插件...

// 集中注册所有插件
export function plugins(): Plugin[] {
  const base = [
    // 优先级最高，必须在最前面
    ...autocompletePlugins(), // 移到最前面，在history之前
    ...history(),
    ...docUpdatedPlugin(),
    ...selectionChangePlugin(),
    ...mentionBranch(),
    ...mentionIndex(),
    ...slot(),
    placeholderPlugin('输入问题，Shift+Enter可换行'),

    // 优先级最低
    ...baseKeymapPlugin(),
    
  ];
  
  return base;
}