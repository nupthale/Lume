import { switchMap, of } from 'rxjs';


import { updateInputCode$ } from '@/store/subscriptions/login/observables';
import { queryClient } from '@/store/queries/client.ts';
import { randCodeKey } from '@/store/queries/login/useRandCode.ts';

export default updateInputCode$.pipe(
    switchMap(() => {
        queryClient.invalidateQueries({ queryKey: [randCodeKey] });
        return of(null);
    })
).subscribe();
