import { computed, ref, Ref } from "vue";
import { useSubscription } from "@vueuse/rxjs";
import { tap } from "rxjs";
import { filter } from 'rxjs/operators';
import { closeAutocomplete } from 'prosemirror-autocomplete';
import { TextSelection } from 'prosemirror-state';
import { User } from '@zsfe/zsui';

import { getConfigBranchStaffList, getConfigBranchList } from '@/api/dataQuery/configQuery.ts';

import { MentionTypeEnum } from '@/components/ChatEditor/interface';
import { autoCompleteOpen$, autoCompleteUp$, autoCompleteDown$, autoCompleteFilter$, autoCompleteEnter$ } from '../../event';

import { picker } from '../../plugins/core/autocomplete';
import { TabEnum } from './interface.tsx';

let branches: { id: string, name: string, index?: number, type: TabEnum.BRANCH }[] = [];
let employees: { id: string, name: string, department: string, index?: number, type: TabEnum.EMPLOYEE }[] = [];

const addIndex = (items: any[]) => {
    // 给items加上index
    let index = 0;
    return items.map((item) => ({
        ...item,
        index: index++,
    }))
}

const initList = async () => {
    try {
        const { result } = await getConfigBranchList();
        branches = result?.map(item => ({
            ...item,
            type: TabEnum.BRANCH,
        })) || [];

        const { result: employeeResult } = await getConfigBranchStaffList({});
        employees = employeeResult?.slice(0, 10)?.map(item => ({
            ...item,
            type: TabEnum.EMPLOYEE,
        })) || [];
    } catch(e) {
        console.error(e);
        branches = [];
        employees = [];
    }
}

initList();

export const useList = (tab: Ref<TabEnum>) => {
    const activeIndex = ref<number>(0);
    const filterText = ref<string>('');

    const scrollElRef = ref<HTMLDivElement | null>(null);
    const contentElRef = ref<HTMLDivElement>();

    const list = computed(() => {
        activeIndex.value = 0;

        if (tab.value === TabEnum.ALL) {
            return [...branches, ...employees];
        }

        if (tab.value === TabEnum.BRANCH) {
            return branches;
        }

        if (tab.value === TabEnum.EMPLOYEE) {
            return employees;
        }

        return [];
    });

    const filteredList = computed(() => {
        if (!filterText.value?.length) {
            return addIndex(list.value);
        }

        const newList = list.value?.filter(item => {
            if (item.name.includes(filterText.value)) {
                return true;
            }
            return false;
        });

        return addIndex(newList);
    });

    const filteredListLen = computed(() => {
        return filteredList.value.length;
    });

    const activeItem = computed(() => {
        let active;
        filteredList.value.forEach((item) => {
            if (item.index === activeIndex.value) {
                active = item;
            }
        });

        return active;
    });

    const handleSelectItem = (index) => {
        activeIndex.value = index;

        const action = picker.action;
        if (!action) return;

        closeAutocomplete(action.view);

        const { from, to } = action.range;
        const tr = action.view.state.tr;

        tr.setMeta('addToHistory', false);
        tr.deleteRange(from, to);
        action.view.dispatch(tr);

        autoCompleteEnter$.next({
            type: MentionTypeEnum.BRANCH,
        });
    }

    const renderBranchItem = (item) => {
        return (
            <>
                <span class="branchIcon flex items-center justify-center w-[32px] h-[32px] flex-shrink-0">
                    <svg t="1787640518832" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="65165" width="20" height="20"><path d="M960.4 401.8H56L244.7 87.2h526.9z" fill="#F9C85D" p-id="65166"></path><path d="M56 401.8h904.4L508.2 938.5z" fill="#1A7FC0" p-id="65167"></path><path d="M260.5 401.8H56L244.7 87.2z" fill="#F9B721" p-id="65168"></path><path d="M260.5 401.8H56l452.2 536.7zM755.9 401.8h204.5L508.2 938.5z" fill="#F9AB10" p-id="65169"></path><path d="M755.9 401.8h204.5L771.6 87.2z" fill="#F9B721" p-id="65170"></path><path d="M508.2 87.2L260.5 401.8h495.4z" fill="#F9D78C" p-id="65171"></path><path d="M508.2 938.5L260.5 401.8h495.4z" fill="#F9C85D" p-id="65172"></path></svg>
                </span>
                <span class="flex-1 truncate text-ellipsis">
                    {item.name?.replace('证券营业部', '') || '-'}
                    {item.name?.includes('证券营业部') ? (<span style="color: #646A73;">营业部</span>) : ''}
                </span>
            </>
        );
    }

    const renderEmployeeItem = (item) => {
        return (
            <>
                <span class="branchIcon flex items-center justify-center w-[32px] h-[32px] flex-shrink-0">
                    <User size="large" username={item.name} showText={false} />
                </span>
                <div class="flex-1 overflow-hidden">
                    <div>{item.name || '-'}</div>
                    <div class="lightText">{item.department}</div>
                </div>
            </>
        );
    }

    const renderList = () => {
        if (!filteredList.value?.length) {
            return (
                <div class="flex-1 flex items-center pl-4">
                    {filterText.value?.length ? '没有匹配结果，换个关键词试试吧' : '无数据'}
                </div>
            );
        }

        return (
            <div class="doc-floatMenusContainer py-2" ref={contentElRef} >
                <div class="mb-2 mx-1 flex flex-col gap-0.5">
                    {
                        filteredList.value.map((item) => {
                            return (
                                <div 
                                    class={[
                                        'doc-floatingMenu-menuItem !w-full !p-1 flex items-center gap-2 !rounded-[4px] overflow-hidden',
                                        activeIndex.value === item.index ? 'active' : '',
                                    ]} 
                                    key={item.id}
                                    onClick={() => handleSelectItem(item.index)}
                                >
                                    {item.type === TabEnum.BRANCH ? renderBranchItem(item) : renderEmployeeItem(item)}
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
            } else if (activeIndex.value === filteredListLen.value - 1) {
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
            filter(({ type }) => type === MentionTypeEnum.BRANCH),
            tap(() => {
                activeIndex.value = 0;
                filterText.value = '';
            }),
        ).subscribe()
    );

    useSubscription(
        autoCompleteUp$.pipe(
            filter(({ type }) => type === MentionTypeEnum.BRANCH),
            tap(() => {
                if (activeIndex.value === 0) {
                    activeIndex.value = filteredListLen.value - 1;

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
            filter(({ type }) => type === MentionTypeEnum.BRANCH),
            tap(() => {
                if (activeIndex.value === filteredListLen.value - 1) {
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
            filter(({ type }) => type === MentionTypeEnum.BRANCH),
            tap(({ filter: text }) => {
                filterText.value = text;
                activeIndex.value = 0;
            }),
        ).subscribe()
    );

    useSubscription(
        autoCompleteEnter$.pipe(
            filter(({ type }) => type === MentionTypeEnum.BRANCH),
            tap(() => {
                if (!activeItem.value) return;

                const action = picker.action;

                if (!action) return;

                const { state } = action.view;
                const { schema } = state;

                const { from } = action.range;

                let tr = state.tr;

                const mentionNode = schema.nodes['mentionBranch'].create({
                    name: activeItem.value?.name,
                }, [
                    schema.text(`${activeItem.value?.name}`)
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

                action.view.dispatch(tr);

            }),
        ).subscribe()
    );

    return {
        scrollElRef,
        renderList,
        filteredListLen,
    };
}