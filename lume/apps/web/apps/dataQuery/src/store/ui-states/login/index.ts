
import { defineStore } from 'pinia';
import { store } from '@/store';
import { LoginFormType } from '@/store/types/login';


interface LoginState {
    // Page loading status
    loginForm: LoginFormType;
}

export const useLoginStore = defineStore({
    id: 'login',
    state: (): LoginState => ({
        loginForm: {
            account: '',
            password: '',
            inputCode: '',
        },
    }),
    getters: {},
    actions: {
        setLoginForm(values: LoginFormType) {
            this.loginForm = values;
        }
    },
});

// Need to be used outside the setup
export function useLoginStoreWithOut() {
    return useLoginStore(store);
}
