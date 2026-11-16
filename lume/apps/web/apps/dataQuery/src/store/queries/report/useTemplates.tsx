import { Ref } from 'vue';
import { Subject } from 'rxjs';
import { useSubscription } from '@vueuse/rxjs'

import { tap } from 'rxjs';

import { useInfiniteQuery } from '@tanstack/vue-query';

import { getDatareportQueryAllReport } from '@/api/dataQuery/dataReport';

export const updateTemplates$ = new Subject();

export const useTemplates = ({
    searchKey,
}: {
    searchKey: Ref<string>
}) => {
    const result =  useInfiniteQuery({
        queryKey: ['data-query-templates', searchKey],
        queryFn: async ({ pageParam = 1 }) => {
            const result = await getDatareportQueryAllReport({
                pageNo: pageParam as number, 
                pageSize: 100,
                searchKey: searchKey.value
            });

            return result;
        },
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const total = lastPage?.result?.total || 0;
            const loadedCount = allPages.flatMap((page) => page?.result?.records || []).length;

            return loadedCount < total ? allPages.length + 1 : undefined;
        }
    });

    useSubscription(
        updateTemplates$.pipe(
            tap(() => {
                result.refetch();
            }),
        ).subscribe()
    );

    return result;
}