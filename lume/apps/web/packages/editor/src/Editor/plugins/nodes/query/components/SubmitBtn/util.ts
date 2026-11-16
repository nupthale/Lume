import { Node } from 'prosemirror-model';

export function getDocText(node: Node): string {
    if (node.isText) {
      return node.text ?? '';
    }
    const mentionAttrs = ['mentionBranch', 'mentionIndex', 'mentionIndexGroup'];
    if (mentionAttrs.includes(node.type.name)) {
      return node.attrs.name ?? '';
    }
    let text = '';
    node.content.forEach((child: Node) => {
      text += getDocText(child);
    });
    return text;
}