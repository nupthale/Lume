import { ref, unref, watch } from 'vue';
import { useElementSize } from '@vueuse/core';
import { QueryFormSchema } from '../types';

export const useGroupSchema = ({ gap, schema }) => {
    const containerRef = ref<HTMLDivElement | null>(null);
    const actionRef = ref<HTMLDivElement | null>(null);

    const { width } = useElementSize(containerRef);
    const { width: actionWidth } = useElementSize(actionRef);

    const flatItems = ref<QueryFormSchema[]>([]);
    const collapsedItems = ref<QueryFormSchema[]>([]);

    watch(() => [unref(width), unref(actionWidth)], ([containerWidth, actionWidth]) => {
        let totalWidth = 0;
        const safeWidth = containerWidth - actionWidth;
        const newFlatItems: QueryFormSchema[] = [];
        const newCollapsedItems: QueryFormSchema[] = [];

        schema.forEach(item => {
            if (totalWidth + item.width + gap < safeWidth) {
                newFlatItems.push(item);
            } else {
                newCollapsedItems.push(item);
            }

            totalWidth += item.width + gap;
        });

        flatItems.value = newFlatItems;
        collapsedItems.value = newCollapsedItems;
    });
    
    return {
        containerRef,
        actionRef,
        flatItems,
        collapsedItems,
    };
}