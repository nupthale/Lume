
import { defineStore } from 'pinia';

interface State {
    crtChat: {
        id: string;
        name?: string;
    } | null;
    initQuestion: string;
}

export const useAgentStore = defineStore({
    id: 'agent-store',
    state: (): State => ({
       crtChat: null,
       initQuestion: '',
    }),
    persist: true,
    getters: {},
    actions: {
        setCrtChat(chat) {
            this.crtChat = chat || null;
        },
        setInitQuestion(question) {
            this.initQuestion = question || '';
        }
    },
});