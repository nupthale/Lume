<script lang="tsx">
import { defineComponent, onMounted, onUnmounted, ref, computed } from 'vue';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node } from 'prosemirror-model';
import { useSubscription } from '@vueuse/rxjs';
import { useEventListener } from '@vueuse/core';
import { tap } from 'rxjs/operators';
import { ArrowUp, Pause, Keyboard, TrendingUpDown, GitBranchPlus, ChartPie, FileChartPie } from 'lucide-vue-next';
import { Tooltip, Dropdown } from 'ant-design-vue';
import { storeToRefs } from 'pinia';
import { TextButton } from '@zsfe/zsui';

import MentionPopover from './components/MentionPopover/index.vue';
import { useContextStore } from './store/context';

import { plugins } from './plugins/index';
import { schema } from './plugins/schema';

import { docChanged$ } from './event';
import { PopoverTypeEnum } from './interface';
import { getDocText } from './util.tsx';
import './theme.less';
import { AgentTypeEnum } from '@/types/agent.ts';

export default defineComponent({
  props: {
    placeholder: {
      type: String,
      default: '发消息，可输入Shift+Enter换行'
    },
    answerLoading: Boolean,
    agentType: String as PropType<AgentTypeEnum>,
    agentSelectable: Boolean,
  },
  emits: ['submit', 'stop', 'changeAgentType'],
  setup(props, { expose, emit }) {
    const editorRef = ref<HTMLElement | null>(null);
    let view: EditorView | null = null;

    const textRef = ref('');

    const contextStore = useContextStore();
    const { popovers, mentionOpen } = storeToRefs(contextStore);

    useSubscription(
      docChanged$.pipe(
        tap(({ text }) => {
            textRef.value = text;
        })
      ).subscribe()
    );

    useEventListener(editorRef, 'keydown', (e) => {
        const mentionVisible = popovers.value[PopoverTypeEnum.MENTION];

        if (e.key === 'Enter' && !e.shiftKey && editorRef.value && !mentionVisible && !mentionOpen.value) {
            emit('submit', props.agentType);
        }
    });

    const initEditor = () => {
      try {
        // 创建初始 EditorState
        const state = EditorState.create({
          schema,
          plugins: plugins(),
        });

        // 创建 EditorView
        // 这里不能覆盖dispatchTransaction， 因为会造成ysync第一次不初始化。如果要监听文档变化，用update 的plugin
        view = new EditorView(editorRef.value, { state });

        contextStore.setEditorView(view);
      } catch(e) {
        console.error(e);
      }
    }

    const clear = () => {
      if (view) {
        const tr = view.state.tr.delete(0, view.state.doc.content.size);
        view.dispatch(tr);
      }
    }

    expose({
      getDoc() {
        const doc = view?.state.doc;
        return {
          doc: doc?.toJSON(),
          text: doc ? getDocText(doc) : '',
        };
      },
      clear() {
        clear();
      },
      setDoc(node: Node) {
        if (!view) return;

        const state = view.state;
        const tr = state.tr;

        tr.deleteRange(0, state.doc.content.size);

        tr.insert(0, node);

        view?.dispatch(tr);
      }
    });

    onMounted(() => {
        initEditor();
    });

    onUnmounted(() => {
      if (view) {
        view.destroy();
        view = null;
        contextStore.setEditorView(null);
      }
    });

    const isDisabledRef = computed(() => {
      return !textRef.value?.length;
    });

    const handleSubmit = () => {
      if (isDisabledRef.value) {
        return;
      }
      
      emit('submit', props.agentType);

      setTimeout(() => {
        clear();
      }, 100);
    }

    const handleStop = () => {
      if (!props.answerLoading) {
        return;
      }

      emit('stop');
    }

    // 渲染场景选择器
    const renderAgentTypes = () => {
      // 指标问数、分支经营、经纪日报、两融日报
      const scenes = [
        { id: AgentTypeEnum.DATA_QUERY, name: '指标问数', icon: TrendingUpDown }, 
        { id: AgentTypeEnum.OPERATION, name: '分支经营', icon: GitBranchPlus  }, 
        { id: AgentTypeEnum.ORDI_REPORT, name: '经纪分析', icon: ChartPie }, 
        { id: AgentTypeEnum.CREDIT_REPORT, name: '两融分析', icon: FileChartPie }, 
      ];

      // 如果指定了agentType， 则不展示选择， 只展示一个
      if (!props.agentSelectable) {
        const selectedScene = scenes.find((item) => item.id === props.agentType);
        if (selectedScene) {
          return (
            <>
              <div class="flex items-center gap-1 text-sm">
                  <selectedScene.icon size={16} />
                  {selectedScene.name}
              </div>
              <div class="divider ml-2 mr-1"></div>
            </>
          );
        } else {
          return '';
        }
      }

      return (
        <>
          <div class="flex items-center gap-1.5">
            {
              scenes.map((item) => (
                <TextButton 
                  key={item.id}
                  onClick={() => emit('changeAgentType', item.id)}
                  class={['agentTypeItem', props.agentType === item.id ? 'active' : '']}
                >
                  <div class="flex items-center gap-1">
                    <item.icon size={16} />
                    {item.name}
                  </div>
                </TextButton>
              ))
            }
          </div>
          <div class="divider ml-2 mr-1"></div>
        </>
      );
    }

    return () => (
      <div class="inputContainer flex flex-col justify-between">
          <div class="overflow-auto min-h-[72px] max-h-[240px] notranslate">
              <div 
                ref={editorRef} 
                class="prose max-w-none" 
                data-placeholder={props.placeholder}
              />
          </div>
          <div class="flex items-center h-8 justify-between gap-1 mt-[12px]">
              <div class="flex items-center self-end overflow-y-hidden overflow-x-hidden gap-1.5">
                  <div class="chatBottomBtn flex-none py-1 px-[9.5px] h-[32px] flex gap-1 items-center rounded-2xl text-sm border-[0.5px] border-solid">
                      <svg xmlns="http://www.w3.org/2000/svg" width="17" height="16" fill="currentColor" viewBox="0 0 17 16" class="!flex items-center justify-center w-[16px] h-[16px]"><path d="M8.795 2.15a3.927 3.927 0 0 1 5.553 5.554l-.295.295.296.296a3.927 3.927 0 0 1-5.553 5.553l-.296-.295-.295.295A3.927 3.927 0 0 1 2.65 8.296L2.945 8l-.295-.296A3.927 3.927 0 1 1 8.204 2.15l.295.295.296-.295Zm4.608.946a2.59 2.59 0 0 0-3.663 0l-.296.294 2.6 2.601a.669.669 0 0 1-.946.945l-3.84-3.84a2.59 2.59 0 0 0-3.662 3.663l.294.295 2.601-2.6a.669.669 0 0 1 .945.945L3.596 9.24a2.59 2.59 0 1 0 3.664 3.663l.295-.296-2.6-2.6a.669.669 0 0 1 .945-.945l3.841 3.841a2.59 2.59 0 1 0 3.663-3.663l-.297-.296-2.598 2.6a.669.669 0 0 1-.946-.945l3.84-3.84a2.59 2.59 0 0 0 0-3.663Zm-5.656 4.15a1.087 1.087 0 1 1 1.536 1.538 1.087 1.087 0 0 1-1.536-1.537Z"></path></svg>
                      深度思考
                  </div>

                  <div class="divider ml-2 mx-2"></div>

                  {renderAgentTypes()}

                  <Dropdown placement='topLeft'>
                    {{
                        overlay: () => (
                            <div class="shortcutWrap">
                              <div class="lightText" style="margin: 8px 8px 0">快捷操作</div>
                              <div class="px-2 py-2 flex flex-col gap-2 w-[160px] text-sm">
                                <div class="flex items-center justify-between">
                                  <div class="shortcutIcon">#1</div>
                                  <div>指标</div>
                                </div>
                                <div class="flex items-center justify-between">
                                  <div class="shortcutIcon">#2</div>
                                  <div>指标组</div>
                                </div>
                                <div class="flex items-center justify-between">
                                  <div class="shortcutIcon">@</div>
                                  <div>分支机构</div>
                                </div>
                              </div>
                            </div>
                        ),
                        default: () => (
                          <TextButton size="small">
                            <div class="flex items-center gap-1 text-sm">
                              <Keyboard size={16} />
                              快捷操作
                            </div>
                          </TextButton>
                        )
                    }}
                  </Dropdown>
              </div>
              <div class="flex gap-1.5 items-center">
                  {
                    props.answerLoading ? (
                      <Tooltip title="停止">
                        <div class={['stopBtn', 'cursor-pointer']} onClick={() => handleStop()}>
                            <Pause size={14} />
                        </div>
                      </Tooltip>
                    ) : (
                      <div class={['submitBtn', 'cursor-pointer', isDisabledRef.value ? 'disabled' : '']} onClick={() => handleSubmit()}>
                          <ArrowUp size={16} />
                      </div>
                    )
                  }
              </div>
          </div>

          <MentionPopover />
      </div>
    );
  }
});
</script>

<style scoped>
.inputContainer {
    border-radius: 20px;
    /* box-shadow: 0 1px 2px -2px rgba(31,35,41,.02),0 2px 4px 0 rgba(31,35,41,.02),0 2px 8px 2px rgba(31,35,41,.02); */
    box-shadow: var(--shadow-1);
    border: 1px solid var(--table-border-color);
    margin: 0 auto;
    min-height: 144px;
    background: var(--blur-bg-filter);
    backdrop-filter: var(--fullscreen-modal-header-filter);
    padding: 12px;

    z-index: 20;
    position: relative;
}

.divider {
  height: 16px;
  width: 1px;
  background: var(--doclist-border-color);
}

.agentTypeItem {
  transition: none!important;
}

.agentTypeItem.active, .agentTypeItem:active {
  color: var(--primary-text-color)!important;
  background: var(--B100)!important;
}

.chatBottomBtn {
    border-color: var(--doclist-border-color);
    cursor: not-allowed;
    background: var(--body-bg);
}

.submitBtn, .stopBtn {
    display: flex;
    align-items: center;
    justify-content: center;

    width: 32px;
    height: 32px;
    border-radius: 100%;

    background: #1456f0;
    border: 1px solid #1456f0;
    color: #fff;

    transition: all .2s ease;
}

.submitBtn:hover { 
    background: #336df4;
    border-color: #336df4;
}

.submitBtn.disabled {
  background: var(--float-border-color);
  border: none;
  cursor: not-allowed;
}

.stopBtn {
  background: var(--O300);
  border: none;
}

.stopBtn:hover {
  background: var(--O350);
  border: none;
}

.shortcutWrap {
  border: 1px solid var(--float-border-color);
  border-radius: 14px;
  background: var(--body-bg);
  backdrop-filter: var(--drawer-filter);
}

.shortcutIcon {
  color: var(--primary-text-color);
  border: 1px solid rgba(31,35,41,.15);
  border-radius: 4px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--fill-color);
}
</style>