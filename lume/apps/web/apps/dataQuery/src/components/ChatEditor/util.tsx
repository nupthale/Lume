import { Node } from 'prosemirror-model';

const mentionTypes = ['mentionBranch', 'mentionIndex', 'mentionIndexGroup'];

function isMention(node: Node): boolean {
    return mentionTypes.includes(node.type.name);
}

export function getDocText(node: Node): string {
    if (node.isText) {
      return node.text ?? '';
    }
    if (isMention(node)) {
      return node.attrs.name ?? '';
    }
    let text = '';
    // 上一个有效子节点是否为 mention，用于在连续 mention 之间自动加逗号
    let prevIsMention = false;
    node.content.forEach((child: Node) => {
      if (isMention(child)) {
        if (prevIsMention) {
          text += '，';
        }
        text += child.attrs.name ?? '';
        prevIsMention = true;
      } else {
        const childText = getDocText(child);
        text += childText;
        // 仅包含空白（含 mention 后插入的零宽空格 \u200B）的文本不视为中断连续 mention
        prevIsMention = prevIsMention && /^[\s\u200B]*$/.test(childText);
      }
    });
    return text;
}