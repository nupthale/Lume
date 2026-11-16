
import { NodeSpec } from 'prosemirror-model';

import { mentionBranchSchema } from '../nodes/mentionBranch/schema';
import { mentionIndexSchema } from '../nodes/mentionIndex/schema';

import { slotSchema } from '../nodes/slot/schema';

export const nodes: Record<string, NodeSpec> = {
  doc: {
    content: "block+"
  } as NodeSpec,

  /// A plain paragraph textblock. Represented in the DOM
  /// as a `<p>` element.
  paragraph: {
    content: "inline*",
    group: "block",
    parseDOM: [{tag: "p"}],
    toDOM() { return ["p", 0] }
  } as NodeSpec,

  /// The text node.
  text: {
    group: "inline"
  } as NodeSpec,
  
  // 添加硬换行节点定义
  hardBreak: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{tag: 'br'}],
    toDOM() { return ['br'] }
  },

  // 添加更多自定义节点...
  ...mentionBranchSchema,
  ...mentionIndexSchema,
  ...slotSchema,
};