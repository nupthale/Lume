import { Subject } from 'rxjs';

import { useQuery } from '@tanstack/vue-query';
import { getConversationList } from '@/api/agent/index';

export const updateTemplates$ = new Subject();

export const useConversations = () => {

    const { data, refetch, isLoading, error } = useQuery({
        queryKey: ['conversations'],
        queryFn: async () => {
            const result = await getConversationList();

            return result?.data?.ConversationList || [];
        },
    });

    return {
        conversations: data,
        refetch,
        isLoading,
        error,
    };
}
