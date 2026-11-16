
import { useQuery } from '@tanstack/vue-query';

import { getBizDomainQueryFirstBizDraftList } from '@/api/dataQuery/bizDomain';
import { FirstBizDomainDraftVO } from '@/api/dataQuery/interface';


export const useDomains = (callback?: Function) => {

    const { data, refetch, isLoading, error } = useQuery({
        queryKey: ['data-query-biz-domains'],
        queryFn: async () => {
            const { result } = await getBizDomainQueryFirstBizDraftList({});

            callback?.(result);

            return result as FirstBizDomainDraftVO[];
        },
    });

    return {
        domains: data,
        refetch,
        isLoading,
        error,
    };
}