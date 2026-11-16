<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Skeleton, Pagination } from 'ant-design-vue';

import Empty from '@/components/Empty/index.vue';
import imgSearchFailed from '@/assets/images/searchFailed.png';
import imgNoContent from '@/assets/images/noContent.png';

// @ts-ignore
const el = ref<HTMLElement | null>(null);

const page = ref(1);
const total = ref(0);

const loading = ref(false);
const error = ref(false);

const props = defineProps({
    items: Array<Object>,
    onLoadMore: Function,
    pageSize: Number,
});

const getItems = async (resetPage: boolean) => {
    if (resetPage) {
        page.value = 1;
    }
    
    try {
        loading.value = true;

        total.value = await props.onLoadMore?.(page.value);
        
        error.value = false;
    } catch(e) {
        error.value = true;
    } finally {
        loading.value = false;
    }
}

defineExpose({
    getItems,
});

onMounted(async () => {
    getItems(true);
});

const handlePageChange = (pageNo) => {
    page.value = pageNo;
    getItems(false);
}
</script>

<template>
    <div class="container" ref="el">
        <div class="h-full flex items-center justify-center" v-if="error">
            <Empty :illustration="imgSearchFailed" message="查询失败，请重试" />
        </div>

        <div v-else-if="loading" style="padding: 0 12px;">
            <Skeleton class="mb-1" active :paragraph="{ rows: 2 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 2 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 2 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 2 }"></Skeleton>
            <Skeleton class="mb-1" active :paragraph="{ rows: 2 }"></Skeleton>
        </div>

        <div v-else-if="items?.length" class="flex flex-col h-full">
            <div class="flex-1 overflow-y-auto">
                <slot v-for="item in items" :item="item" />
            </div>
            
            <div class="paginationWrap flex justify-between">
                <div v-if="$slots.footerLeft">
                    <slot name="footerLeft" />
                </div>

                <div class="flex-1 flex justify-end">
                    <Pagination 
                        class="pagination"
                        :current="page"
                        :pageSize="pageSize"
                        :total="total"
                        :showSizeChanger="false"
                        size="small"
                        :onChange="handlePageChange"
                    />
                </div>
            </div>
        </div>
       
        <div v-else class="productList__empty">
            <Empty :illustration="imgNoContent" message="未找到搜索结果" />
        </div>
    </div>
</template>

<style scoped>
.container {
    overflow: hidden;
}

.productList__empty {
    margin-top: 100px;
}

.paginationWrap {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 6px;
    background: #fff;
    margin-bottom: -12px;
    border-top: 1px solid rgba(0, 0, 0, 0.07);
    box-shadow: rgba(100, 100, 111, 0.2) 0px 7px 29px 0px;
}

.pagination {
    margin-top: 0!important;
}
</style>