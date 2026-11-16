<script lang="tsx">
import { defineComponent, ref } from 'vue';
import { useSubscription } from '@vueuse/rxjs';
import { tap, filter } from 'rxjs/operators';
import { Tabs } from 'ant-design-vue';

import Popover from '../Popover/index.vue';

import { PopoverTypeEnum, MentionTypeEnum } from '../../interface';
import { showPopover$, autoCompleteOpen$ } from '../../event';

import { TabEnum } from './interface.tsx';
import { useList } from './useList';
import { picker } from '../../plugins/core/autocomplete';

import './index.less';

const TabPane = Tabs.TabPane;

export default defineComponent({
    setup(_props) {
        const tab = ref<TabEnum>(TabEnum.ALL);

        const { scrollElRef, renderList } = useList(tab);

        useSubscription(
            autoCompleteOpen$.pipe(
                filter(({ type }) => type === MentionTypeEnum.BRANCH),
                tap(({ range }) => {
                    const { from } = range;

                    showPopover$.next({
                        range: [from!, from!],
                        type: PopoverTypeEnum.MENTION,
                    });
                })
            ).subscribe()
        );

        return () => (
            <Popover type={PopoverTypeEnum.MENTION} contentBorder={false}>
                {{
                    default: () => (
                        <div class="container">
                            <div>
                                <Tabs size="small" activeKey={tab.value} onChange={(key) => {
                                    tab.value = key as TabEnum;
                                    // 点击 tab 会让编辑器失焦，需把焦点还给编辑器，否则上下键不会触发 reducer
                                    picker.action?.view?.focus();

                                    scrollElRef.value?.scrollTo({ top: 0 });
                                }}>
                                    <TabPane key={TabEnum.ALL} tab="全部"></TabPane>
                                    <TabPane key={TabEnum.BRANCH} tab="营业部"></TabPane>
                                    <TabPane key={TabEnum.EMPLOYEE} tab="人员"></TabPane>
                                </Tabs>
                            </div>
                            <div class="flex-1 overflow-y-auto flex flex-col" ref={scrollElRef}>
                                {renderList()}
                            </div>
                        </div>
                    )
                }}
            </Popover>
        );
    }
});
</script>

<style scoped>
.container {
    display: flex;
    flex-direction: column;
    width: 360px;
    height: 100%;
    min-height: 168px;
    overflow: hidden;
    background: var(--body-bg);

    border: 1px solid var(--float-border-color);
    border-radius: 6px;
}

.container :deep(.ant-tabs-nav-wrap) {
    padding: 0 16px;
}

.container :deep(.ant-tabs-nav) {
    margin-bottom: 0;
}

.doc-floatMenu-divier {
    width: 100%;
    height: 1px;
    background: var(--float-border-color);
    margin: 4px 0;
}

.doc-floatingMenu-menuItem {
    cursor: pointer;
    height: 46px;
}

.doc-floatingMenu-menuItem:hover {
    background: var(--menu-item-hover);
}

.doc-floatingMenu-menuItem.active {
    background: var(--menu-item-hover);
}


.doc-floatMenu-title {
    margin: 8px 8px 0px;

}

.doc-floatMenusContainer {
    font-size: 14px;
    color: var(--title-text);
}
</style>