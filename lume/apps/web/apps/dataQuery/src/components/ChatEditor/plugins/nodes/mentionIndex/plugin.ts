
import { Plugin, PluginKey } from 'prosemirror-state';
import { MentionIndexView } from './view';

export function mentionIndex(): Plugin[] {
  return [
    new Plugin({
      key: new PluginKey('mentionIndex'),
      props: {
        nodeViews: {
          mentionIndex: (node, view) => {
            return new MentionIndexView(node, view);
          }
        },
      }
    })
  ];
}