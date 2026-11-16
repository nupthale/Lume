import { Subject } from 'rxjs';
import { LoginFormType } from '@/store/types/login';

// 更新验证码
export const updateInputCode$ = new Subject();

// 登录
export const login$ = new Subject<LoginFormType>();