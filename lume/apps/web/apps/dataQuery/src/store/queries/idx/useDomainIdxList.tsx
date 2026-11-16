import { useQuery } from '@tanstack/vue-query';
import { getConfigSerachDomainIndexList } from '@/api/dataQuery/configQuery'; 

export const useDomainIdxList = (searchText, searchDomainCode) => {

    const { data, refetch, isLoading, error } = useQuery({
        queryKey: ['domian-idx-list', searchText, searchDomainCode],
        queryFn: async () => {
            const { result } = await getConfigSerachDomainIndexList({
                searchName: searchText.value, 
                searchDomainCode: searchDomainCode.value,
            });

            return result?.index;
        },
    });

    return {
        data,
        refetch,
        isLoading,
        error,
    };
}
