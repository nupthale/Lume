import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { PopoverTypeEnum } from '../interface';


export const useContextStore = defineStore('chats-editor-context', () => {
  const editorView = shallowRef<EditorView | null>(null);
  
  const popovers = ref<Record<PopoverTypeEnum, boolean>>({
    [PopoverTypeEnum.MENTION]: false,
  });
  const mentionOpen = ref(false);

  function setEditorView(v: EditorView | null) {
    editorView.value = v;
  }
  
  function setPopoverVisible(type: PopoverTypeEnum, visible: boolean) {
    popovers.value = { ...popovers.value, [type]: visible };
  }
  
  function setMentionOpen(open: boolean) {
    mentionOpen.value = open;
  }
  
  return {
    editorView,
    popovers,
    mentionOpen,
    setEditorView,
    setPopoverVisible,
    setMentionOpen,
  };
});