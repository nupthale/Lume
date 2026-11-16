import { computed, ref } from "vue";
import { useSubscription } from "@vueuse/rxjs";
import { tap } from "rxjs";
import { filter } from 'rxjs/operators';
import { closeAutocomplete } from 'prosemirror-autocomplete';

import { getConfigQuerySceneList } from '../../../../../../apps/dataQuery/src/api/dataQuery/configQuery';

import { autoCompleteOpen$, autoCompleteUp$, autoCompleteDown$, autoCompleteFilter$, autoCompleteEnter$ } from '../../event';

import { PopoverTypeEnum } from '@editor/Editor/interface';

import { picker } from '../../plugins/core/autocomplete';

let indexes: { id: string, name: string, index?: number }[] = [];

const addIndex = (indexes: any[]) => {
    // 给items加上index
    let index = 0;
    indexes.forEach((item) => {
        item.index = index++;
    });
}

const initIndexGroups = async () => {
    try {
        const { result } = await getConfigQuerySceneList();
        const list: any[] = [];
        
        result?.forEach(item => {
            list.push({
                id: item.scene_code,
                name: item.scene_name,
            });
        });

        indexes = list;
    } catch(e) {
        console.error(e);
        indexes = [];
    }
}

initIndexGroups();

export const useNavigate = () => {
    const activeIndex = ref<number>(0);
    const filterText = ref<string>('');

    const scrollElRef = ref<HTMLDivElement | null>(null);
    const contentElRef = ref<HTMLDivElement>();

    const filteredIndexGroups = computed(() => {
        
        if (!filterText.value?.length) {
            addIndex(indexes);
            return indexes;
        }

        const newIndexGroups = indexes.filter(item => {
            if (item.name.includes(filterText.value)) {
                return true;
            }
            return false;
        });

        addIndex(newIndexGroups);

        return newIndexGroups;
    });

    const filteredIndexGroupsLen = computed(() => {
        return filteredIndexGroups.value.length;
    });

    const activeItem = computed(() => {
        let index;
        filteredIndexGroups.value.forEach((item) => {
            if (item.index === activeIndex.value) {
                index = item;
            }
        });

        return index;
    });

    const handleSelectIndex = (index) => {
        activeIndex.value = index;

        const action = picker.action;
        if (!action) return;

        closeAutocomplete(action.view);

        const { from, to } = action.range;
        const tr = action.view.state.tr;

        tr.setMeta('addToHistory', false);
        tr.deleteRange(from, to);
        action.view.dispatch(tr);

        autoCompleteEnter$.next({ type: PopoverTypeEnum.INDEXGROUP });
    }

    const renderIndexGroups = () => {
        return (
            <div class="w-[320px] doc-floatMenusContainer" ref={contentElRef} >
                <div class="doc-floatMenu-title lightText">指标组</div>
                <div class="mb-2 mx-1 flex flex-col gap-0.5">
                    {
                        filteredIndexGroups.value.map((item) => {
                            return (
                                <div 
                                    class={[
                                        'doc-floatingMenu-menuItem !w-full !p-1 flex items-center gap-1 !rounded-[4px] overflow-hidden',
                                        activeIndex.value === item.index ? 'active' : '',
                                    ]} 
                                    key={item.id}
                                    onClick={() => handleSelectIndex(item.index)}
                                    onMouseenter={() => activeIndex.value = item.index || 0}
                                >
                                    <span class="flex-1 truncate text-ellipsis">
                                        {item.name || '-'}
                                    </span>
                                </div>
                            );
                        })
                    }
                </div>
            </div>
        );
    };

    const scrollToActiveItem = () => {
        if (!scrollElRef.value || !contentElRef.value) return;
        const activeItem = scrollElRef.value.querySelector('.active') as HTMLElement;

        if (!activeItem) return;
        // 判断activeItem是否在scrollEl元素的可视区域
        const scrollElRect = scrollElRef.value.getBoundingClientRect();
        const activeItemRect = activeItem.getBoundingClientRect();
        const contentElRect = contentElRef.value.getBoundingClientRect();

        

        // 在不可见区域
        if (
            activeItemRect.top - scrollElRect.top > scrollElRect.height ||
            activeItemRect.top < scrollElRect.top
        ) {
            if (activeIndex.value === 0) {
                scrollElRef.value.scrollTop = 0;
            } else if (activeIndex.value === filteredIndexGroupsLen.value - 1) {
                scrollElRef.value.scrollTop = contentElRect.height - scrollElRect.height + 16;
            } else {
                // // 在上方不可见区域
                if (activeItemRect.top < scrollElRect.top) {
                    scrollElRef.value.scrollTop = (activeItemRect.top - contentElRect.top);
                } else {
                    scrollElRef.value.scrollTop += (activeItemRect.top - contentElRect.top) + scrollElRect.height - activeItemRect.height;
                }
            }
        }
    };

    useSubscription(
        autoCompleteOpen$.pipe(
            filter(({ type }) => type === PopoverTypeEnum.INDEXGROUP),
            tap(() => {
                activeIndex.value = 0;
                filterText.value = '';
            }),
        ).subscribe()
    );

    useSubscription(
        autoCompleteUp$.pipe(
            tap(() => {
                if (activeIndex.value === 0) {
                    activeIndex.value = filteredIndexGroupsLen.value - 1;

                } else {
                    activeIndex.value--;
                }

                setTimeout(() => {
                    scrollToActiveItem();
                }, 0);
            }),
        ).subscribe()
    );

    useSubscription(
        autoCompleteDown$.pipe(
            tap(() => {
                if (activeIndex.value === filteredIndexGroupsLen.value - 1) {
                    activeIndex.value = 0;
                } else {
                    activeIndex.value++;
                }

                setTimeout(() => {
                    scrollToActiveItem();
                }, 0);
            }),
        ).subscribe()
    );

    useSubscription(
        autoCompleteFilter$.pipe(
            tap(({ filter: text }) => {
                filterText.value = text;
                activeIndex.value = 0;
            }),
        ).subscribe()
    );

    useSubscription(
        autoCompleteEnter$.pipe(
            filter(({ type }) => type === PopoverTypeEnum.INDEXGROUP),
            tap(() => {
                if (!activeItem.value) return;

                const action = picker.action;

                if (!action) return;

                const { state } = action.view;
                const { schema } = state;

                const { from } = action.range;

                let tr = state.tr;

                const mentionNode = schema.nodes['mentionIndex'].create({
                    name: activeItem.value?.name,
                    type: PopoverTypeEnum.INDEXGROUP,
                }, [
                    schema.text(`${activeItem.value?.name}`)
                ]);

                tr.insert(
                    from, 
                    mentionNode,
                );

                action.view.dispatch(tr);

            }),
        ).subscribe()
    );

    return {
        scrollElRef,
        renderIndexGroups,
        filteredIndexGroupsLen,
    };
}