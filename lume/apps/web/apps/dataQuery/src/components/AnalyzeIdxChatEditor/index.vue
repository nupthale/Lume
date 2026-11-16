<script lang="tsx">
import { defineComponent, ref, computed } from 'vue';
import { ChevronDown, LibraryBig, Search, Plus } from 'lucide-vue-next';
import { Input, Tabs, Modal } from 'ant-design-vue';
import { Selection } from 'prosemirror-state'
import { TextButton, EllipsisText } from '@zsfe/zsui';
import { ActionKind } from 'prosemirror-autocomplete';

import Empty from '@/components/Empty/index.vue';
import imgSearchFailed from '@/assets/images/searchFailed.png';

import { picker } from '@/components/ChatEditor/plugins/core/autocomplete';
import HighlightText from '@/components/HighlightText/index.vue';
import ChatEditor from '@/components/ChatEditor/index.vue';
import AddIndicatorGroup from './components/AddIndicatorGroup/index.vue';

import { useContextStore } from '@/components/ChatEditor/store/context';
import { useAnalyzeIdxList } from '@/store/queries/idx/useAnalyzeIdxList';
import { useMetricsConfig } from '@/store/queries/idx/useMetricsConfig';
import { useMetricsStore } from '@/store/ui-states/metrics/index';
import { usePermissionStore } from '@/store/modules/permission';

import { postConfigDeleteSceneInfo, getDataConfigSceneInfo } from '@/api/dataQuery/configQuery';

import { useMentionIndex } from './hooks/useMentionIndex';
import { useMaxHeight } from './hooks/useMaxHeight';
import { MentionTypeEnum } from '../ChatEditor/interface';
import { SYSTEM_SET } from './interface';
import { AgentTypeEnum } from '@/types/agent.ts';

const TabPane = Tabs.TabPane;

export default defineComponent({
    props: {
        placeholder: {
            type: String,
            default: '发消息，可输入Shift+Enter换行'
        },
        answerLoading: Boolean,
    },
    emits: ['submit', 'stop'],
    setup(props, { expose, emit }) {
        const store = useMetricsStore();

        const permissionStore = usePermissionStore();

        const editorRef = ref();
        const searchTextRef = ref('');

        const tabRef = ref('2');

        const collapseRef = ref(true);

        const { idx } = useAnalyzeIdxList();

        const { metrics, refetch } = useMetricsConfig();

        const { containerRef, maxHeightRef } = useMaxHeight();

        const contextStore = useContextStore();

        expose({
            getDoc: () => editorRef.value?.getDoc(),
            clear: () => editorRef.value?.clear(),
            setDoc: (node: Node) => editorRef.value?.setDoc(node),
        });

        const filterIdxList = computed(() => {
            let idCounter = 0;

            if (!searchTextRef.value?.length) {
                return (idx.value?.index || []).map(item => ({
                    ...item,
                    indexes: (item.indexes || []).map( idx => ({ ...idx, id: idCounter++ }))
                }))
            };

            const filterIndex: any[]  = [];

            idx.value?.index?.forEach(item => {
                const filterIndexes = item.indexes?.filter(idx => idx.name?.includes(searchTextRef.value) || idx.caliber?.includes(searchTextRef.value));

                if (filterIndexes.length) {
                    filterIndex.push({
                        domain: item.domain,
                        indexes: filterIndexes.map(idx => ({ ...idx, id: idCounter++ })),
                    })
                }
            });

            return filterIndex;
        });

        const totalIdxCount = computed(() => {
            return (filterIdxList.value || []).reduce(
                (total, item) => total + (item.indexes?.length || 0), 0
            );
        });

        const filterSceneList = computed(() => {
            return [];

            // let idCounter = 0;

            // const list = metrics.value || [];
            // const keyword = searchTextRef.value?.trim();

            // const matchedList = keyword ? list.filter(item => item.scene_name?.includes(keyword)) : list;

            // return matchedList.map(({ metrics: _, ...rest }) => ({
            //     ...rest,
            //     name: rest.scene_name,
            //     id: idCounter++
            // }));
        });

        const handleUpdate = async (metrics) => {
            try {
                const { result } = await getDataConfigSceneInfo({sceneCode: metrics.scene_code});
                const data = result?.[0] || {};
                
                store.setMetricsModalVisible(true);
                store.setMetricsConfigModalForm({...data});
            } catch (error) {
                console.log(error);
            }
        };

        const handleDelete = async (metrics) => {
            Modal.confirm({
                title: '删除',
                content: () => <div>确定要删除<span class="mx-1 font-bold underline">{metrics.scene_name}</span>指标组吗？</div>,
                okText: '删除',
                okType: 'danger',
                cancelText: '取消',
                centered: true,
                onOk: async () => {
                    try {
                        await postConfigDeleteSceneInfo({sceneCode: metrics.scene_code});

                        refetch();
                    } catch(e) {
                        console.error(e);
                    }
                }
            });
        };
        

        const { 
            activeIndex,
            scrollElRef,
            contentElRef,
            insertMention,
         } = useMentionIndex({
            collapseRef,
            tabRef,
            searchTextRef,
            filterIdxList,
            filterSceneList,
        });

        const handleInsertMention = (text: string, type: MentionTypeEnum) => {
            // 如果是通过autocomplete触发的打开， 鼠标点击时，则使用picker里带的view
            const action = picker.action;
            if (action && action?.kind !== ActionKind.close) {
                const { from, to } = action.range;
                const tr = action.view.state.tr;

                tr.setMeta('addToHistory', false);
                tr.deleteRange(from, to);
                action.view.dispatch(tr);

                const view = action.view;
                insertMention(view, from, type, text);
                return;
            }

            // 如果是自己点开的，则单独处理
            const view = contextStore.editorView;
            if (!view) return;

            const state = view.state;
            const lastPos = Selection.atEnd(state.doc).from;
            insertMention(view, lastPos, type, text);
        }

        const renderEmpty = () => {
            return (
                <div class="h-full flex items-center justify-center">
                    <Empty illustration={imgSearchFailed} message="当前暂无数据" />
                </div>
            );
        }

        const renderGroupList = (list, type: MentionTypeEnum) => {
            if (!list?.length) {
                return renderEmpty();
            }

            return (
                <div class="flex flex-col px-2">
                    {
                        list?.map((metrics) => (
                            <div 
                                class={['idxItem', 'group', 'flex', 'items-center', 'justify-between', 'gap-2', activeIndex.value === metrics.id ? 'active' : '']} 
                                key={metrics.scene_code} 
                                onClick={() => handleInsertMention(metrics.scene_name, type)}
                                onMouseenter={() => {
                                    activeIndex.value = metrics.id;
                                }}
                            >
                                <div>
                                    <div>
                                        <HighlightText
                                            text={metrics.scene_name}
                                            highlightText={searchTextRef.value}
                                        />
                                    </div>
                                    <div>
                                        {
                                            metrics.match_desc ? (
                                                <EllipsisText title={metrics.match_desc}>
                                                    <div class="text-sm itemDesc">{metrics.match_desc}</div>
                                                </EllipsisText>
                                            ) : <div class="text-sm itemDesc">暂无描述</div>
                                        }
                                    </div>
                                </div>
                                <div class="flex items-center flex-nowrap">
                                    <div class="hidden group-hover:flex">
                                        {
                                            (
                                                (metrics.sys_preset === SYSTEM_SET.NO) ||
                                                (metrics.sys_preset === SYSTEM_SET.YES && permissionStore.hasPermission('operate:system_set'))
                                            ) ? (
                                                <>
                                                    <TextButton type="primary" size="small" onClick={(e) => { e.stopPropagation(); handleUpdate(metrics) }}>编辑</TextButton>
                                                    <TextButton type="warning" size="small" onClick={(e) => { e.stopPropagation(); handleDelete(metrics) }}>删除</TextButton>
                                                </>
                                            ) : ''
                                        }
                                    </div>
                                    {
                                        metrics.sys_preset === SYSTEM_SET.YES ? (
                                            <div class="itemDimensionTag">内置</div>
                                        ) : ''
                                    }
                                </div>
                            </div>
                        ))
                    }
                </div>
            );
        }

        const renderIndexList = (list) => {
            if (!list.length) {
                return renderEmpty();
            }

            return list.map(domain => (
                <div class="px-2">
                    <div class="px-2 sectionTitle py-2 domainTitle" style="font-size: 14px">{domain.domain}</div>
                    {
                        domain.indexes?.map((idx) => (
                            <div 
                                class={['idxItem', 'flex', 'items-center', 'justify-between', activeIndex.value === idx.id ? 'active' : '']} 
                                key={idx.name} 
                                onClick={() => handleInsertMention(idx.name, MentionTypeEnum.INDEX)}
                                onMouseenter={() => {
                                    activeIndex.value = idx.id;
                                }}
                            >
                                <div>
                                    <div>
                                        <HighlightText
                                            text={idx.name}
                                            highlightText={searchTextRef.value}
                                        />
                                    </div>
                                    {
                                        idx.caliber ? (
                                            <EllipsisText title={idx.caliber}>
                                                <div class="text-sm itemDesc">{idx.caliber}</div>
                                            </EllipsisText>
                                        ) : ''
                                    }
                                </div>
                                <div class="itemAction flex-shrink-0">
                                    {
                                        idx.dimension?.length ? (
                                            <div class="itemDimensionTag">
                                                {idx.dimension?.join('/')}
                                            </div>
                                        ) : ''
                                    }
                                </div>
                            </div>
                        ))
                    }
                </div>
            ));
        }

        const renderIdxBody = () => {
            return (
                <div class="flex flex-col pb-2 mt-1 h-full overflow-hidden">
                    <div class="px-2 mt-0.5">
                        <Input block placeholder="请输入关键字查询" value={searchTextRef.value} onChange={(e) => searchTextRef.value = e.target.value || ''}>
                            {{
                                suffix: () => (
                                    <Search size={14} />
                                )
                            }}
                        </Input>
                    </div>

                    <div class="px-4">
                        <Tabs size="small" activeKey={tabRef.value} onChange={tab => tabRef.value = tab as string}>
                            {{
                                default: () => (
                                    <>
                                        <TabPane key="2">
                                            {{
                                                tab: () => (
                                                    <span>
                                                        指标
                                                        <span class="text-xs ml-1">{totalIdxCount.value}</span>
                                                    </span>
                                                )
                                            }}
                                        </TabPane>
                                    </>
                                ),
                                rightExtra: () => tabRef.value === '1' ? (
                                    <div>
                                        <TextButton type="primary" size="small" onClick={() => store.setMetricsModalVisible(true) }>
                                            <div class="flex items-center gap-1 text-sm">
                                                <Plus size={14} />
                                                添加指标组
                                            </div>
                                        </TextButton>
                                    </div>
                                ) : ''
                            }}
                        </Tabs>
                    </div>

                    <div class="flex-1 overflow-y-auto flex flex-col" ref={scrollElRef}>
                        <div ref={contentElRef} class="min-h-full">
                            {
                                tabRef.value === '1' ? (
                                    renderGroupList(filterSceneList.value, MentionTypeEnum.INDEXGROUP)
                                ) : (
                                    renderIndexList(filterIdxList.value)
                                )
                            }
                        </div>
                    </div>
                </div>
            );
        }

        return () => (
            <div>
                <div class="relative" ref={containerRef}>
                    <div class={['idxContainer absolute bottom-0 w-full transition-all duration-300 ease-linear overflow-hidden flex flex-col']} style={{ maxHeight: collapseRef.value ? '63px': `${maxHeightRef.value}px`, height: collapseRef.value ? '63px': `${maxHeightRef.value}px` }}>
                        <div class="flex items-center justify-between h-[40px] px-4" onClick={() => collapseRef.value = !collapseRef.value}>
                            <div class="flex items-center gap-1">
                                <LibraryBig size={14} stroke="#646a73" />
                                <span class="text-sm">指标</span>
                            </div>
                            <div class={['transition duration-500 ease-in', collapseRef.value ? 'rotate-180' : 'rotate-0']}>
                                <ChevronDown size={18} stroke="#646a73" />
                            </div>
                        </div>
                        <div class="flex-1 overflow-hidden">
                            {renderIdxBody()}
                        </div>
                    </div>
                </div>
                
                <ChatEditor
                    ref={editorRef}
                    agentType={AgentTypeEnum.OPERATION}
                    placeholder={props.placeholder}
                    answerLoading={props.answerLoading}
                    onSubmit={() => emit('submit')}
                    onStop={() => emit('stop')}
                />

                <AddIndicatorGroup></AddIndicatorGroup>
            </div>
        );
    }
})
</script>

<style scoped>
.idxContainer {
    margin-bottom: -21px;
    padding-bottom: 21px;
    background: var(--blur-bg-filter);
    backdrop-filter: var(--fullscreen-modal-header-filter);

    border: 1px solid var(--table-border-color)!important;
    border-radius: 24px 24px 0 0;
    cursor: pointer;
    z-index: 10;
}

.idxContainer :deep(.ant-tabs-nav) {
    margin-bottom: 8px;
}

.idxItem {
    position: relative;
    font-size: 13px;
    height: 46px;
    color: var(--light-text-color);
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
}

.idxItem:after {
    position: absolute;
    content: '';
    bottom: -1px;
    left: 8px;
    right: 8px;
    height: 1px;
    background: var(--table-border-color);
}

.idxItem:last-of-type:after {
    display: none;
}

.idxItem.active {
    background: var(--fill-color);
}

.itemDesc {
    color: var(--N400);
}

.itemDimensionTag {
    font-size: 10px;
    padding: 2px 4px;
    background: var(--N200);
    border-radius: 4px;
}

.domainTitle {
    position: sticky!important;
    top: 0;
    background: var(--blur-bg-filter2);
    z-index: 2;
}
</style>