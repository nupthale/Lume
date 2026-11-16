import { Subject } from 'rxjs';

import { MentionTypeEnum } from '@/components/ChatEditor/interface';

export const openIdxPanel$ = new Subject<{
    tab: MentionTypeEnum,
}>();

export const closeIdxPanel$ = new Subject<void>();