
import { Plugin, PluginKey } from 'prosemirror-state';
import { MentionBranchView } from './view';

export function mentionBranch(): Plugin[] {
  return [
    new Plugin({
      key: new PluginKey('mentionBranch'),
      props: {
        nodeViews: {
          mentionBranch: (node, view) => {
            return new MentionBranchView(node, view);
          }
        },
      }
    })
  ];
}