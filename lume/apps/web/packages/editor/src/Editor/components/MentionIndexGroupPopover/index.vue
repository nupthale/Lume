<script lang="tsx">
import { defineComponent } from 'vue';

import Popover from '../Popover/index.vue';

import { PopoverTypeEnum } from '../../interface';
import { useNavigate } from './useNavigate';

export default defineComponent({
    setup(_props) {

        const { scrollElRef, renderIndexGroups, filteredIndexGroupsLen } = useNavigate();

        return () => (
            <Popover type={PopoverTypeEnum.INDEXGROUP}>
                {{
                    default: () => filteredIndexGroupsLen.value > 0 ?(
                        <div class="wrap flex-1 overflow-y-auto" ref={scrollElRef}>
                            {renderIndexGroups()}
                        </div>
                    ) : ''
                }}
            </Popover>
        );
    }
});
</script>

<style scoped>
.wrap {
    border-radius: 4px;
}

.doc-floatMenu-divier {
    width: 100%;
    height: 1px;
    background: var(--float-border-color);
    margin: 4px 0;
}

.doc-floatingMenu-menuItem {
    cursor: pointer;
    height: 32px;
    line-height: 32px;
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