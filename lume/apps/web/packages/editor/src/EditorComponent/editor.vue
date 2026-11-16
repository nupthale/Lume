<script lang="tsx">
import { defineComponent, onMounted, onUnmounted, ref, Teleport, PropType } from 'vue';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { applyDevTools } from 'prosemirror-dev-toolkit';
import { useMediaQuery } from '@vueuse/core';
import { message } from 'ant-design-vue';

import { plugins } from '@editor/Editor/plugins';
import { schema } from '@editor/Editor/plugins/schema';

import FloatingMenu from '@editor/Editor/components/FloatingMenu/index.vue';
import TopFloatingMenu from '@editor/Editor/components/FloatingMenu/top.vue';
import MentionMenusPopover from '@editor/Editor/components/MentionMenusPopover/index.vue';
import BubbleMenu from '@editor/Editor/components/BubbleMenu/index.vue';
import Catalog from '@editor/Editor/components/Catalog/index.vue';
import MentionBranchPopover from '@editor/Editor/components/MentionBranchPopover/index.vue';
import MentionIndexPopover from '@editor/Editor/components/MentionIndexPopover/index.vue';
import MentionIndexGroupPopover from '@editor/Editor/components/MentionIndexGroupPopover/index.vue';
import EmojiSelectPopopver from '@editor/Editor/components/EmojiSelectPopover/index.vue';
import LinkPopover from '@editor/Editor/components/LinkPopover/index.vue';
import SearchReplace from '@editor/Editor/components/SearchReplace/index.vue';

import { contextStore } from '@editor/Editor/store/context';
import { docScroll$ } from '@editor/Editor/event';
import { useAddEmptyBlock } from '@editor/Editor/hooks/useAddEmptyBlock';
import { useClickEditorOutside } from '@editor/Editor/hooks/useClickEditorOutside';
import { useEditorBlur } from '@editor/Editor/hooks/useEditorBlur';
import { useDocScrollTo } from '@editor/Editor/hooks/useDocScrollTo';  
import { useDragToSelect } from '@editor/Editor/hooks/useDragToSelect';
import { useStopTab } from '@editor/Editor/hooks/useStopTab';
import { useExport } from '@editor/Editor/hooks/useExport';
import { useAIQuery } from '@editor/Editor/hooks/useAIQuery';

import { UserType } from '../Editor/interface';
import { docInit$ } from '../Editor/event';

import '@editor/Editor/theme/index.less';
import { defaultDoc } from '@editor/doc';

export default defineComponent({
  props: {
    doc: Object,
    docMetaComponent: {
      type: Object,
    },
    titleFormatter: {
      type: Function,
    },
    user: Object as PropType<UserType>,
  },
  setup(props, { slots }) {
    const editorRef = ref<HTMLElement | null>(null);
    const scrollEl = ref<HTMLElement | null>(null);
    let view: EditorView | null = null;

    const isSmallScreen = useMediaQuery('(max-width: 1600px)');

    const isInit = ref(false);
    const { editorDomRef } = useAddEmptyBlock();
    const { selectionRectRef } = useDragToSelect(editorDomRef);

    useEditorBlur();
    useClickEditorOutside();
    useDocScrollTo();
    useStopTab(editorRef);
    useExport(() => view);
    useAIQuery();

    const initEditor = () => {
      if (!editorRef.value || isInit.value) return;
      
      isInit.value = true;

      message.destroy();

      try {
        // 创建初始 EditorState
        const state = EditorState.create({
          schema,
          doc: schema.nodeFromJSON(props.doc?.doc || defaultDoc),
          plugins: plugins(schema),
        });

        // 创建 EditorView
        // 这里不能覆盖dispatchTransaction， 因为会造成ysync第一次不初始化。如果要监听文档变化，用update 的plugin
        view = new EditorView(editorRef.value, { state });
        contextStore.getState().setEditorView(view);

        if (import.meta.env.MODE !== 'production') {
          applyDevTools(view);
        }

        docInit$.next({
            doc: view.state.toJSON().doc,
            text: view.state.doc.textContent,
        });
      } catch(e) {
        console.error(e);
      }
    }

    onMounted(() => {
      if (!isInit.value) {
        message.loading('连接中...');
      }

      const contextState = contextStore.getState();

      contextState.setDocInfo(props.doc!);
      contextState.setDocMetaComponent(props.docMetaComponent);
      contextState.setScrollEl(scrollEl.value);
      contextState.setTitleFormatter(props.titleFormatter);

      initEditor();
    });

    onUnmounted(() => {
      if (view) {
        view.destroy();
        view = null;
      }
    });

    const handleDocScroll = (e) => {
      docScroll$.next({ e });
    }

    return () => (
      <div class="w-full h-full overflow-auto" id="scrollEl" ref={scrollEl} onScroll={handleDocScroll}>
        <div class="doc-header-container">
          {slots.header?.()}
        </div>
        
        {/* 左侧目录 */}
        <Catalog />

        <div class="relative min-h-[100vh]">
          <div class="flex overflow-hidden">
            <div class="w-[820px] pb-[72px] mx-auto" ref={editorDomRef}>
                <div ref={editorRef} class="prose max-w-none"></div>
            </div>
          </div>
        </div>

        <FloatingMenu />
        <TopFloatingMenu />
        

        <BubbleMenu />

        <MentionMenusPopover />
        <MentionBranchPopover />
        <MentionIndexPopover />
        <MentionIndexGroupPopover />
        <EmojiSelectPopopver />
        <LinkPopover />
        <SearchReplace />

        <Teleport to={document.body}>
          <div ref={selectionRectRef} class="fixed"></div>
        </Teleport>
      </div>
    );
  }
});
</script>