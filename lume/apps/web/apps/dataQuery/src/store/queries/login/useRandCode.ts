import { useQuery } from '@tanstack/vue-query';
import { getCodeInfo } from '@/api/sys/user';

export const randCodeKey = 'randcode';

export const checkKey = '1629428467008';

export const useRandCode = () => {
    const { data } = useQuery({
        queryKey: [randCodeKey],
        queryFn: async () => getCodeInfo(checkKey),
    });

    return {
        randCodeImgSrc: data,
    };
}