import { Subject } from 'rxjs';

export const openPreviewSider$ = new Subject<{ initQuestion?: string }>();