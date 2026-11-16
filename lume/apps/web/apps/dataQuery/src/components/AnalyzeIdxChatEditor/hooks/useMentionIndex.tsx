import { Ref, ref, computed, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import { TextSelection } from 'prosemirror-state';

import { useSubscription } from '@vueuse/rxjs';
import { filter, tap } from 'rxjs/operators';

import { autoCompleteOpen$, autoCompleteClose$, autoCompleteFilter$, autoCompleteEnter$ } from '@/components/ChatEditor/event';
import { MentionTypeEnum, PopoverTypeEnum } from '@/components/ChatEditor/interface';

import { picker } from '@/components/ChatEditor/plugins/core/autocomplete';
import { openIdxPanel$, closeIdxPanel$ } from '../event';
import { useContextStore } from '@/components/ChatEditor/store/context';
import { storeToRefs } from 'pinia';

export const useMentionIndex = ({
    collapseRef,
    tabRef,
    searchTextRef,
    filterIdxList,
    filterSceneList,
}: {
    collapseRef: Ref<boolean>,
    tabRef: Ref<string>,
    searchTextRef: Ref<string>,
    filterIdxList: Ref<{ name: string }[]>,
    filterSceneList: Ref<{ name: string }[]>,
}) => {
    const activeIndex = ref<number>(0);
    const scrollElRef = ref<HTMLDivElement>();
    const contentElRef = ref<HTMLDivElement>();

    const flatList = computed(() => {
        const currentList = tabRef.value === '1' ? filterSceneList.value : filterIdxList.value;
        if (!currentList) return [];

        if (tabRef.value === '1') {
            return currentList;
        }

        return currentList.flatMap((group: any) => 
            (group.indexes || []).map(item => ({
                ...item,
            }))
        );
    });

    const activeItem = computed(() => {
        return flatList.value.find(item => item.id === activeIndex.value)
    });

    const contextStore = useContextStore();
    const { popovers } = storeToRefs(contextStore);

    watch(() => tabRef.value, () => {
        activeIndex.value = flatList.value[0]?.id || 0;
    });

    useEventListener(document.body, 'keydown', (e) => {
        if (collapseRef.value) return;

        if (popovers.value[PopoverTypeEnum.MENTION]) {
            return;
        }

        if (e.code === 'ArrowDown') {
            handleGoDown();
        } else if (e.code === 'ArrowUp') {
            handleGoUp();
        }
    });

    const scrollToActiveItem = () => {
        if (!scrollElRef.value || !contentElRef.value) return;
        const activeItem = scrollElRef.value.querySelector('.idxItem.active') as HTMLElement;

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
            const currentIndex = flatList.value.findIndex(item => item.id === activeIndex.value);

            if (activeIndex.value === 0) {
                scrollElRef.value.scrollTop = 0;
            } else if (currentIndex === flatList.value.length - 1) {
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
        openIdxPanel$.pipe(
            tap(({ tab }) => {
                tabRef.value = tab === MentionTypeEnum.INDEXGROUP ? '1' : '2';
                collapseRef.value = false;
            })
        ).subscribe()
    );

    useSubscription(
        closeIdxPanel$.pipe(
            tap(() => {
                collapseRef.value = true;
                tabRef.value = '1';
            })
        ).subscribe()
    );

    useSubscription(
        autoCompleteOpen$.pipe(
            filter(({ type }) => [MentionTypeEnum.INDEX, MentionTypeEnum.INDEXGROUP].includes(type)),
            tap(({ type }) => {
                contextStore.setMentionOpen(true);

                openIdxPanel$.next({
                    tab: type,
                })
            })
        ).subscribe()
    );

    useSubscription(
        autoCompleteClose$.pipe(
            tap(() => {
                setTimeout(() => {
                    contextStore.setMentionOpen(false);
                }, 0);
            })
        ).subscribe()
    );

    const handleGoUp = () => {
        if (!flatList.value.length) return;

        const currentIndex = flatList.value.findIndex(item => item.id === activeIndex.value);

        if (currentIndex <= 0) {
            activeIndex.value = flatList.value[flatList.value.length - 1].id;
        } else {
            activeIndex.value = flatList.value[currentIndex - 1].id;
        }

        setTimeout(() => {
            scrollToActiveItem();
        }, 0);
    }

    const handleGoDown = () => {
        if (!flatList.value.length) return;

        const currentIndex = flatList.value.findIndex(item => item.id === activeIndex.value);

        if (currentIndex === -1 || currentIndex >= flatList.value.length - 1) {
            activeIndex.value = flatList.value[0].id;
        } else {
            activeIndex.value = flatList.value[currentIndex + 1].id;
        }

        setTimeout(() => {
            scrollToActiveItem();
        }, 0);
    }

    useSubscription(
        autoCompleteFilter$.pipe(
            filter(({ type }) => [MentionTypeEnum.INDEX, MentionTypeEnum.INDEXGROUP].includes(type)),
            tap(({ filter: text }) => {
                searchTextRef.value = text;
                setTimeout(() => {
                    activeIndex.value = flatList.value[0]?.id || 0;
                }, 0)
            }),
        ).subscribe()
    );

    const insertMention = (view, from, type, text: string) => {
        const state = view.state;

        const { schema } = state;

        let tr = state.tr;

        const mentionNode = schema.nodes['mentionIndex'].create({
            name: text,
            type,
        }, [
            schema.text(`${text}`)
        ]);

        const textNode = schema.text('\u200B');

        tr.insert(
            from, 
            mentionNode,
        );

        tr.insert(
            from + mentionNode.nodeSize,
            textNode,
        );

        // focus到新的block
        tr.setSelection(
            TextSelection.create(
                tr.doc, 
                from + mentionNode.nodeSize + textNode.nodeSize,
            )
        );

        view.dispatch(tr);

        searchTextRef.value = '';

        closeIdxPanel$.next();
    }

    useSubscription(
        autoCompleteEnter$.pipe(
            filter(({ type }) => [MentionTypeEnum.INDEX, MentionTypeEnum.INDEXGROUP].includes(type)),
            tap(({ type }) => {
                if (!activeItem.value) return;

                const action = picker.action;

                if (!action) return;

                const view = action.view;
                const { from } = action.range;
                insertMention(view, from, type, activeItem.value?.name);
            }),
        ).subscribe()
    );

    return {
        activeIndex,
        scrollElRef,
        contentElRef,
        insertMention,
    };
};