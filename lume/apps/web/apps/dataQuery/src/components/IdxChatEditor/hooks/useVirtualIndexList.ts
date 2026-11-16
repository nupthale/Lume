import { computed, Ref } from 'vue';
import { useVirtualList } from '@vueuse/core';

// 分组标题行高：py-2(8px * 2) + .sectionTitle line-height(16px)
export const DOMAIN_TITLE_HEIGHT = 32;
// .idxItem固定高度
export const IDX_ITEM_HEIGHT = 46;

export type VirtualIndexItem =
    | { type: 'domain'; domain: string }
    | { type: 'index'; index: any };

/**
 * 指标列表虚拟滚动（列表数量可能超过1000，全量渲染会卡顿）
 * 分组标题行与指标行高度不一致，itemHeight使用函数形式按行类型返回高度
 */
export const useVirtualIndexList = ({
    filterIdxList,
    tabRef,
}: {
    filterIdxList: Ref<any[]>;
    tabRef: Ref<string>;
}) => {
    // 分组数据拍平成虚拟列表行（分组标题行 + 指标行）
    const virtualFlatList = computed<VirtualIndexItem[]>(() => {
        const result: VirtualIndexItem[] = [];

        filterIdxList.value.forEach((domainItem) => {
            result.push({ type: 'domain', domain: domainItem.domain });
            (domainItem.indexes || []).forEach((idxItem) => {
                result.push({ type: 'index', index: idxItem });
            });
        });

        return result;
    });

    const { list: virtualItems, containerProps, wrapperProps } = useVirtualList(virtualFlatList, {
        itemHeight: (index: number) => virtualFlatList.value[index]?.type === 'domain' ? DOMAIN_TITLE_HEIGHT : IDX_ITEM_HEIGHT,
        overscan: 10,
    });

    // 指标id -> 虚拟列表行索引，用于键盘导航定位
    const virtualIndexMap = computed(() => {
        const map = new Map<number, number>();

        virtualFlatList.value.forEach((item, i) => {
           
            if (item.type === 'index') {
                map.set(item.index.id, i);
            }
        });

        return map;
    });

    // 每一行顶部的累计偏移量，用于键盘导航滚动定位
    const virtualOffsets = computed(() => {
        const offsets: number[] = [];
        let acc = 0;

        virtualFlatList.value.forEach((item, i) => {
            offsets[i] = acc;
            acc += item.type === 'domain' ? DOMAIN_TITLE_HEIGHT : IDX_ITEM_HEIGHT;
        });
        offsets[virtualFlatList.value.length] = acc;

        return offsets;
    });

    // 虚拟滚动模式下的活动项滚动定位（返回false则回退到DOM定位逻辑）
    const scrollToActive = (activeItem: any): boolean => {
        if (tabRef.value !== '1') return false;

        const virtualIndex = virtualIndexMap.value.get(activeItem?.id);
        if (virtualIndex === undefined) return false;

        const el = containerProps.ref.value as HTMLDivElement | null;
        if (el) {
            const top = virtualOffsets.value[virtualIndex] ?? 0;
            const bottom = top + IDX_ITEM_HEIGHT;

            // 活动项不在可视区域时才滚动，保证其可见
            if (top < el.scrollTop) {
                el.scrollTop = top;
            } else if (bottom > el.scrollTop + el.clientHeight) {
                el.scrollTop = bottom - el.clientHeight;
            }
        }

        return true;
    };

    // 当前虚拟行是否为分组内最后一项（下一行是分组标题或列表末尾），用于分割线控制
    const isLastInGroup = (index: number) => {
        return index === virtualFlatList.value.length - 1 || virtualFlatList.value[index + 1]?.type === 'domain';
    };

    return {
        virtualItems,
        containerProps,
        wrapperProps,
        scrollToActive,
        isLastInGroup,
    };
};
