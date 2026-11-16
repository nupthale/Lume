import { Ref } from 'vue';
import { Subject } from 'rxjs';

import { useQuery } from '@tanstack/vue-query';
import { getConfigQueryDomainIndexTypeList } from '@/api/dataQuery/configQuery';

import { AgentTypeEnum } from '@/types/agent';

export const updateTemplates$ = new Subject();

export const useIdxList = (agentType: Ref<AgentTypeEnum>) => {
    const { data, refetch, isLoading, error } = useQuery({
        queryKey: ['idx-list', agentType],
        queryFn: async () => {
            const { result } = await getConfigQueryDomainIndexTypeList({
                indexType: agentType.value,
            });

            return result;
        },
    });

    return {
        idx: data,
        refetch,
        isLoading,
        error,
    };
}
