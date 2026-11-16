<script lang="tsx">
import { defineComponent } from 'vue';

import Chat from './modules/Chat/index.vue';

import { useCreateConversation } from '@/store/subscriptions/agent/observers/useCreateConversation';

export default defineComponent({
    setup() {
        useCreateConversation();

        return () => (
            <div class="wrap">
                <div class="h-[100vh] flex flex-col gap-6">
                    <Chat />
                </div>
            </div>
        );
    }
})
</script>

<style scoped>
.wrap {
    border-left: 1px solid var(--home-sider-borderRight);
    background: var(--body-bg);
    overflow-y: auto;
    background-image: url('@/assets/homebg3.png');
    background-position: 50%;
    background-repeat: no-repeat;
    background-size: cover;
}

:root[data-theme="dark"] .wrap {
    background: var(--chat-messages-bg);
}
</style>