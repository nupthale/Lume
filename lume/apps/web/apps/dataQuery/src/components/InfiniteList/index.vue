<script setup lang="ts">
import { ref, onMounted, PropType, toRef } from 'vue';
import { useInfiniteScroll, useVirtualList, UseVerticalVirtualListOptions } from '@vueuse/core';
import { Skeleton } from 'ant-design-vue';

import Empty from '@/components/Empty/index.vue';
import imgSearchFailed from '@/assets/images/searchFailed.png';
import imgNoContent from '@/assets/images/noContent.png';
import Loading from '@/components/Loading/index.vue';

const page = ref(1);

const loading = ref(false);
const loadMoreLoading = ref(false);
const error = ref(false);
const hasMore = ref(true);

const props = defineProps({
    items: {
        type: Array<Object>,
        default: () => [],
    },
    onLoadMore: Function,
    virtualOptions: Object as PropType<UseVerticalVirtualListOptions>,
});

const itemsRef = toRef(props, 'items');

const { list, containerProps, wrapperProps } = useVirtualList(
    itemsRef,
    (props.virtualOptions || {}) as UseVerticalVirtualListOptions,
);

const getItems = async (resetPage: boolean) => {
    if (resetPage) {
        page.value = 1;
    } else {
        page.value = page.value + 1;
    }
    
    try {
        if (resetPage) {
            loading.value = true;
        } else {
            loadMoreLoading.value = true;
        }

        const total = await props.onLoadMore?.(page.value);
        hasMore.value = total > (props.items?.length || 0);
        
        error.value = false;
    } catch(e) {
        error.value = true;
    } finally {
        if (resetPage) {
            loading.value = false;
        } else {
            loadMoreLoading.value = false;
        }
    }
}

defineExpose({
    getItems,
});

useInfiniteScroll(
    containerProps.ref,
    () => {
        getItems(false);
    },
    { 
        distance: 0,
        canLoadMore: () => !loadMoreLoading.value && !loading.value && !error.value && hasMore.value,
    }
);

onMounted(async () => {
    getItems(true);
});
</script>

<template>
    <div class="scrollContainer" v-bind="containerProps">
        <div class="h-full flex items-center justify-center" v-if="error">
            <Empty :illustration="imgSearchFailed" message="查询失败，请重试" />
        </div>

        <div v-else-if="loading" style="padding: 0 12px;">
            <Skeleton class="mb-1" active :paragraph="{ rows: 3 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 3 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 3 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 3 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 3 }"></Skeleton>
        </div>

        <div v-else-if="items?.length"  v-bind="wrapperProps">
            <div v-for="item in list" :style="{ height: `${virtualOptions?.itemHeight}px` }" class="overflow-y-hidden">
                <slot :item="item.data"></slot>
            </div>
        </div>
       
        <div v-else class="productList__empty">
            <Empty :illustration="imgNoContent" message="未找到搜索结果" />
        </div>

        <div class="loadingBox relative flex items-center justify-center" v-if="loadMoreLoading">
            <Loading :style="{ width: '64px', height: '40px', position: 'relative' }" />
        </div>
    </div>
</template>

<style scoped>
.scrollContainer {
    overflow-y: auto;
}

.productList__empty {
    margin-top: 100px;
}
</style>