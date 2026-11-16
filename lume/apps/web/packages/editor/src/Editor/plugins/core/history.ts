import { history as historyPlugin, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Plugin } from 'prosemirror-state';

export function history(): Plugin[] {

  return [
    historyPlugin(),
    keymap({
      'Mod-z': undo,
      'Mod-y': redo,
      'Shift-Mod-z': redo,
    }),
    // keymap({
    //   "Mod-z": () => {
    //     if (undoManager.canUndo()) {
    //       undoManager.undo();
    //       return true;
    //     }
    //     return false;
    //   },
    //   "Mod-y": () => {
    //     if (undoManager.canRedo()) {
    //       undoManager.redo();
    //       return true;
    //     }
    //     return false;
    //   },
    //   "Shift-Mod-z": () => {
    //     if (undoManager.canRedo()) {
    //       undoManager.redo();
    //       return true;
    //     }
    //     return false;
    //   }
    // }),
  ];
} 