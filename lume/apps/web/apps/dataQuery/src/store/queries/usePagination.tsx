import { ref, Ref, watch, computed } from 'vue';
import { useQuery, QueryKey, keepPreviousData } from '@tanstack/vue-query';
import { isNil } from 'lodash-es';

import TableIndicator from '@/components/Loading/TableIndicator.vue'; 

const orderMap = {
    'ascend': 'asc',
    'descend': 'desc',
};

type sortedInfoType = {
    columnKey?: string,
    order?: string,
};

export function usePagination<T>({ 
    queryKey, 
    params,
    api,
    defaultPageSize = 10,
    enabled,
}: { 
    queryKey: QueryKey, 
    params?: Ref<Record<string, any>>,
    api: Function,
    defaultPageSize?: number,
    enabled?: Ref<boolean>,
}): {
    data: Ref<T | undefined>;
    error: Ref<Error | null>;
    refetch: () => void;
    reset: (resetOnly?: boolean) => void;
    pageNo: Ref<number>;
    pageSize: Ref<number>;
    total: Ref<number>;
    loadNextPage: () => void;
    handlePageChange: (page: number, size: number) => void;
    loading: Ref<any>;
    isFetching: Ref<boolean>;
    isLoading: Ref<boolean>;
    showTotal: (total: number) => JSX.Element;
    sortedInfo: Ref<sortedInfoType>,
    handleTableChange: (pagination: any, filter: any, sorter: any) => void,
} {
    const pageNo = ref(1);
    const pageSize = ref(defaultPageSize);

    const sortedInfo = ref({} as sortedInfoType);

     // 搜索条件变化时,重置分页
     watch([params], () => {
        reset(true);
    });

    const handleTableChange = (_pagination, _filters, sorter) => {
        // 自定义排序逻辑：第一次点击降序，第二次点击升序，第三次点击取消排序
        if (sorter.columnKey) {
            const currentColumnKey = sortedInfo.value.columnKey;
            const currentOrder = sortedInfo.value.order;
            
            if (currentColumnKey === sorter.columnKey) {
                // 同一列：降序 -> 升序 -> 取消排序
                if (currentOrder === 'descend') {
                    sortedInfo.value = { columnKey: sorter.columnKey, order: 'ascend' };
                } else if (currentOrder === 'ascend') {
                    sortedInfo.value = {};
                } else {
                    sortedInfo.value = { columnKey: sorter.columnKey, order: 'descend' };
                }
            } else {
                // 不同列：直接设置为降序
                sortedInfo.value = { columnKey: sorter.columnKey, order: 'descend' };
            }
        } else {
            sortedInfo.value = {};
        }

        refetch();
    };
    
    const { data, refetch, isFetching, isLoading, error } = useQuery<T>({
        queryKey,
        enabled: isNil(enabled?.value) ? undefined : enabled,
        queryFn: async () => {
            const { result } = await api({
                pageNo: pageNo.value,
                pageSize: pageSize.value,
                order: sortedInfo.value.columnKey && sortedInfo.value.order ? `${sortedInfo.value.columnKey} ${orderMap[sortedInfo.value.order]}` : undefined,
                ...params?.value,
            });

            return {
                ...result,
                // 加个时间戳，否则如果数据没变化, data不会触发watch变化
                _t: +new Date(),
            };
        },
        placeholderData: keepPreviousData,
    });

    const reset = (resetOnly = false) => {
        sortedInfo.value = {};
        pageNo.value = 1;
        total.value = 0;

        if (!resetOnly) {
            refetch();
        }
    }

    const loadNextPage = () => {
        pageNo.value = pageNo.value + 1;
        refetch();
    }

    const handlePageChange = (page, size) => {
        pageNo.value = page;
        pageSize.value = size;

        refetch();
    }


    const total = ref(0);
    
    watch(data, () => {
        // @ts-ignore
        total.value = data.value?.total || 0;
    });

    const showTotal = (total) => <span class="text-xs">共<span class="mx-1 text-base font-medium" style="color: color: rgb(31, 35, 41);">{ total }</span>条数据</span>;

    const loading = computed(() => ({
        spinning: isLoading.value || isFetching.value,
        indicator: <TableIndicator />,
    }));

    return {
        data,
        error,
        refetch,
        reset,
        pageNo,
        pageSize,
        total,
        loadNextPage,
        handlePageChange,
        loading,
        isLoading,
        isFetching,
        showTotal,
        sortedInfo,
        handleTableChange,
    };
}