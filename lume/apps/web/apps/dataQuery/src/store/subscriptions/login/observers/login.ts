import { toRaw } from 'vue';
import { switchMap } from 'rxjs';
import { message } from 'ant-design-vue';


import { login$, updateInputCode$ } from '@/store/subscriptions/login/observables';
import { useUserStoreWithOut } from '@/store/modules/user';
import { checkKey } from '@/store/queries/login/useRandCode';


const userStore = useUserStoreWithOut();

export default login$.pipe(
    switchMap(async (formData) => {
        try {
            await userStore.login(
                toRaw({
                    password: formData.password,
                    username: formData.account,
                    captcha: formData.inputCode,
                    checkKey,
                    mode: 'none', //不要默认的错误提示
                })
            );
        } catch (error) {
            message.error(error.message || '网络错误');

            //update-begin-author:taoyan date:2022-5-3 for: issues/41 登录页面，当输入验证码错误时，验证码图片要刷新一下，而不是保持旧的验证码图片不变
            updateInputCode$.next({});
            //update-end-author:taoyan date:2022-5-3 for: issues/41 登录页面，当输入验证码错误时，验证码图片要刷新一下，而不是保持旧的验证码图片不变
        }
    })
).subscribe();
