<script lang="tsx">
import { defineComponent, ref } from 'vue';
import { useSubscription } from '@vueuse/rxjs';
import { switchMap } from 'rxjs/operators';
import { TextButton } from '@zsfe/zsui';
import { storeToRefs } from 'pinia';

import Icon from '@/components/Icon/index.vue';
import { postCreatePreviewConversation } from '@/api/agent';
import { useReportsStore } from '@/store/ui-states/reports/index.ts';

import { AgentTypeEnum } from '@/types/agent.ts';

import Main from './Main.vue';
import { openPreviewSider$ } from './event.ts';

export default defineComponent({
    setup() {
        const reportsStore = useReportsStore();
        const { previewSiderVisible } = storeToRefs(reportsStore);  

        const conversationId = ref();
        const initQuestionRef = ref();

        useSubscription(
            openPreviewSider$.pipe(
                switchMap(async ({ initQuestion }) => {
                    try {
                        let result = await postCreatePreviewConversation({
                            ConversationName: initQuestion,
                            AgentType: AgentTypeEnum.DATA_QUERY,
                        });

                        const conversation = result?.data?.Conversation;

                        conversationId.value = conversation.AppConversationID;

                        reportsStore.setPreviewSiderVisible(true);
                        initQuestionRef.value = initQuestion;
                    } catch(e) {
                        console.error(e);
                    }
                })
            ).subscribe()
        )

        const renderMain = () => {
            return (
                <div class="previewSider relative">
                    <div class="previewSider__closeBtn">
                        <div class="fixed top-[70px]">
                            <TextButton onClick={() => reportsStore.setPreviewSiderVisible(false)}>
                                <Icon icon="close_outlined" size="16px"></Icon>
                            </TextButton>
                        </div>
                    </div>

                    <Main key={initQuestionRef.value} initQuestion={initQuestionRef.value} conversationId={conversationId.value} />
                </div>
            );
        }

        return () => (
            <div class={['previewSider-wrap', previewSiderVisible.value ? 'open' : '']}>
                {previewSiderVisible.value ? renderMain() : ''}
            </div>
        );
    }
});
</script>

<style scoped lang="less">
.previewSider-wrap {
    width: 0;
    max-width: 0;
    min-width: 0;
    flex-shrink: 0;
    overflow-x: hidden;
    transition: all .2s ease;

    &.open {
        max-width: 40%;
        min-width: 40%;
    }
}

.previewSider__closeBtn {
    position: sticky;
    display: flex;
    justify-content: flex-end;
    padding-right: 28px;
    width: 100%;
    height: 0;
    background: red;
    top: 70px;
    float: right;
    z-index: 30;
}

.previewSider {
    height: 100%;
    padding-top: 55px;
    border-left: 1px solid var(--default-border-color);
}
</style>