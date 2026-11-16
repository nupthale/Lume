import { Ref } from 'vue';
import { Subject } from 'rxjs';
import { useSubscription } from '@vueuse/rxjs'

import { tap } from 'rxjs';

import { useInfiniteQuery } from '@tanstack/vue-query';

import { getReportDetailQueryAllReport } from '@/api/dataQuery/dataReportDetail';

export const updateReports$ = new Subject();

export const useReports = ({
    searchKey,
}: {
    searchKey: Ref<string>
}) => {
    const result =  useInfiniteQuery({
        queryKey: ['data-query-reports', searchKey],
        queryFn: async ({ pageParam = 1 }) => {
            const result = await getReportDetailQueryAllReport({
                pageNo: pageParam as number, 
                pageSize: 100,
                searchKey: searchKey.value
            });

            return result;
        },
        refetchInterval: 5000,
        initialPageParam: 1,
        getNextPageParam: (lastPage, allPages) => {
            const total = lastPage?.result?.total || 0;
            const loadedCount = allPages.flatMap((page) => page?.result?.records || []).length;

            return loadedCount < total ? allPages.length + 1 : undefined;
        }
    });

    useSubscription(
        updateReports$.pipe(
            tap(() => {
                result.refetch();
            }),
        ).subscribe()
    );

    return result;
}