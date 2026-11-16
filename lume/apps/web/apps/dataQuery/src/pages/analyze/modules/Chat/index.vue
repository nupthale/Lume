<script lang="tsx">
import { defineComponent, ref } from 'vue';
import dayjs from 'dayjs';
import { TextButton } from '@zsfe/zsui';
import { Node } from 'prosemirror-model';

import { AgentTypeEnum } from '@/types/agent.ts';
import aiAvartar3 from '@/assets/aiAvatar3.mp4';
import AnalyzeIdxChatEditor from '@/components/AnalyzeIdxChatEditor/index.vue';
import RecommendChats from '../RecommendChats/index.vue';

import { createConversation$ } from '@/store/subscriptions/agent/observables/index';

export default defineComponent({
    setup() {

        const editorRef = ref();

        const helloText = () => {
            const now = dayjs();
            const hour = now.hour();
            // 如果是早上6点到11点， 显示上午
            if (hour >= 6 && hour < 12) {
                return '早上好';
            } else if (hour >= 12 && hour < 14) {
                return '中午好';
            } else if (hour >= 14 && hour < 18) {
                return '下午好';
            } else {
                return '晚上好';
            }
        }

        const handleSelect = (node: Node) => {
            editorRef.value?.setDoc(node);
        }

        const handleAddConversation = async () => {
            try {
                const doc = editorRef.value?.getDoc();
                const query = doc.text || '';

                if (!query?.trim()) {
                    return;
                }

                createConversation$.next({ query, agentType: AgentTypeEnum.OPERATION });
            } catch(e) {
                console.error(e);
            }
        }

        return () => (
            <div class="flex-1 flex flex-col w-full items-center justify-center max-w-[740px] mx-auto">
                <div class="w-[68px] h-[68px]">
                    {/* <img src={aiAvartar} alt="brand-logo" width="68" height="68" class="rounded-full" /> */}
                    <video src={aiAvartar3} width="68" height="68" class="rounded-full" autoplay loop muted />
                </div>
                <div class="max-w-full mt-4 mb-14">
                    <span class="text-2xl max-w-full" style="-webkit-line-clamp: 4; font-weight: 500;">
                        {helloText()}，有什么可以帮你的吗？
                    </span>
                </div>
                <div class="w-full my-5">
                   <AnalyzeIdxChatEditor 
                        ref={editorRef}
                        onSubmit={handleAddConversation} 
                    />
                </div>
                <div class="w-full flex items-center justify-between pl-1 mb-3">
                    <div class="font-semibold">推荐指令</div>
                    <div class="flex items-center gap-6">
                        <TextButton disabled>
                            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-icon="SpaceLeftOutlined"><path d="M1.293 11.293a1 1 0 0 0 0 1.414l7 7a1 1 0 0 0 1.414-1.414L4.414 13H21a1 1 0 1 0 0-2H4.414l5.293-5.293a1 1 0 0 0-1.414-1.414l-7 7Z" fill="currentColor"></path></svg>
                        </TextButton>
                        <TextButton disabled>
                            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-icon="SpaceRightOutlined"><path d="M21.707 11.293a1 1 0 0 1 0 1.414l-7 7a1 1 0 0 1-1.414-1.414L18.586 13H2a1 1 0 1 1 0-2h16.586l-5.293-5.293a1 1 0 0 1 1.414-1.414l7 7Z" fill="currentColor"></path></svg>
                        </TextButton>
                    </div>
                </div>
                <RecommendChats onSelect={handleSelect} />
            </div>
        );
    }
});
</script>

<style scoped>

</style>