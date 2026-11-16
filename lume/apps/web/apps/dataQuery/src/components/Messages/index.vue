<script lang="tsx">
import { defineComponent, PropType, watch, ref, nextTick } from 'vue';
import { useElementSize } from '@vueuse/core';
import { tap } from 'rxjs/operators';
import { useSubscription } from '@vueuse/rxjs';

import Answer from './Answer.vue';

import { MessageType, MessageRoleEnum } from './interface';
import { reachEnd$ } from './event';

const TOLERANCE = 0;

export default defineComponent({
    props: {
        messages: Array as PropType<MessageType[]>,
        answerLoading: Boolean,
        showFooter: Boolean,
    },
    emits: ['regenerate', 'feedback', 'submitChat'],
    setup(props, { emit }) {
        const containerRef = ref();
        const contentRef = ref();

        // If current scrollTop at the end. User scroll will make this false.
        const reachEndRef = ref(true);

        const { height } = useElementSize(contentRef);

        watch([height, props.messages], (crt, prev) => {
            const prevHeight = prev?.[0] || 0;

            nextTick(() => {
                scrollToBottom(prevHeight !== 0 && prev?.[1] !== crt?.[1]);
            });
        });

        useSubscription(
            reachEnd$.pipe(
                tap(() => {
                    reachEndRef.value = true;

                    scrollToBottom();
                })
            ).subscribe()
        );

        const handleScroll = () => {
            if (!containerRef.value) {
                return;
            }

            reachEndRef.value = containerRef.value.scrollHeight - containerRef.value.scrollTop - containerRef.value.clientHeight <= TOLERANCE;
        }

        const scrollToBottom = (smooth: boolean = true) => {
            if (!containerRef.value || !reachEndRef.value) {
                return;
            }

            requestAnimationFrame(() => {
                containerRef.value.scrollTo({
                    top: containerRef.value.scrollHeight - containerRef.value.clientHeight,
                    behavior: smooth ? 'smooth' : undefined,
                });
            });
        }

        watch(() => props.answerLoading, (isAnswerLoading) => {
            if (isAnswerLoading) {
                scrollToBottom();
            } else {
                // 结束后， 跳转到最底部
                setTimeout(() => {
                    scrollToBottom();
                }, 100)
            }
        });

        const renderMessage = (message: MessageType, index: number) => {
            if (message.role === MessageRoleEnum.USER) {
                return (
                    <div class="question self-end max-w-[75%] w-fit py-3 px-4 text-[15px] leading-6 whitespace-pre-wrap break-all rounded-[16px] rounded-br-[4px]">
                        {message.content}
                    </div>
                );
            }

            return (
                <Answer
                    message={message} 
                    answerLoading={props.answerLoading}
                    showFooter={props.showFooter}
                    isLast={props.messages?.length === index + 1}
                    onRegenerate={(messageId) => emit('regenerate', messageId)}
                    onFeedback={(messageId, like) => emit('feedback', messageId, like)}
                    onSubmitChat={(query) => emit('submitChat', query)}
                />
            );
        }

        return () => (
            <div class="h-full overflow-y-auto pb-[30px]" ref={containerRef} onScroll={handleScroll}>
                <div class="messages max-w-[740px] w-full mx-auto flex flex-col gap-8" ref={contentRef}>
                    {
                        props.messages?.map((message, index) => renderMessage(message, index))
                    }
                </div>
                <div class="scroll-anchor"></div>
            </div>
            
        );
    }
})
</script>

<style scoped>
.messages {
    font-size: 15px;
    line-height: 26px;
}

.question {
    background: var(--question-bg)!important;
}

.scroll-anchor {
    overflow-anchor: auto;
    height: 1px;
}
</style>