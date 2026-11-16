<script lang="tsx">
import { defineComponent, PropType, toRef, ref } from 'vue';
import { Tooltip } from 'ant-design-vue';
import { TextButton } from '@zsfe/zsui';
import { Copy, RefreshCcw, ThumbsUp, ThumbsDown, ChevronRight, ChevronDown, CircleCheckBig } from 'lucide-vue-next';

import { useClipboard } from '@vueuse/core';

import 'highlight.js/styles/github.css';

import TraceContent from './TraceContent.vue';
import { useMdToVue } from './hooks/useMdToVue';

import { MessageType, MessageLikeEnum } from './interface';

import './index.less';

export default defineComponent({
    props: {
        message: Object as PropType<MessageType>,
        isLast: Boolean,
        answerLoading: Boolean,
        showFooter: Boolean,
    },
    emits: ['regenerate', 'feedback', 'submitChat'],
    setup(props, { emit }) {
        const { copy } = useClipboard({
            legacy: true,
        });

        const collapseProcess = ref(!props.isLast);

        const feedbackRef = ref(props.message?.like);

        const messageRef = toRef(props, 'message');
        const answerLoadingRef = toRef(props, 'answerLoading');
        const isLastRef = toRef(props, 'isLast');

        const { answerComponent } = useMdToVue(messageRef, answerLoadingRef, isLastRef);

        const handleLike = () => {
            feedbackRef.value = feedbackRef.value === MessageLikeEnum.LIKE ? MessageLikeEnum.NONE : MessageLikeEnum.LIKE;


            emit('feedback', props.message?.id, feedbackRef.value);
        }

        const handleDislike = () => {
            feedbackRef.value = feedbackRef.value === MessageLikeEnum.DISLIKE ? MessageLikeEnum.NONE : MessageLikeEnum.DISLIKE;

            emit('feedback', props.message?.id, feedbackRef.value);
        }

        const renderActions = () => {
            if (!props.showFooter) {
                return '';
            }

            if (props.answerLoading && props.isLast) {
                return '';
            }

            return (
                <div class="messageFooter flex items-center justify-between">
                    <div class="actions flex w-fit min-w-0 items-center gap-[10px] self-center">
                        <Tooltip title="复制" onClick={() => copy(props.message?.content ?? '')}>
                            <TextButton>
                                <Copy size={16} />
                            </TextButton>
                        </Tooltip>
                        
                        {
                            props.isLast ? (
                                <Tooltip title="重新生成">
                                    <TextButton onClick={() => emit('regenerate', props.message?.id)}>
                                        <RefreshCcw size={16} />
                                    </TextButton>
                                </Tooltip>
                            ) : ''
                        }

                        <Tooltip title="喜欢">
                            <TextButton onClick={() => handleLike()}>
                                {
                                    feedbackRef.value === MessageLikeEnum.LIKE ? (
                                        <ThumbsUp size={16} fill="#ffc60a" stroke="#ffc60a" />
                                    ) : (
                                         <ThumbsUp size={16} />
                                    )
                                }
                            </TextButton>
                        </Tooltip>

                        <Tooltip title="不喜欢" onClick={() => handleDislike()}>
                            <TextButton>
                                {
                                    feedbackRef.value === MessageLikeEnum.DISLIKE ? (
                                        <ThumbsDown size={16} fill="#a6a6a6" stroke="#a6a6a6" />
                                    ) : (
                                         <ThumbsDown size={16} />
                                    )
                                }
                            </TextButton>
                        </Tooltip>
                    </div>
                    <div class="flex w-fit min-w-0 items-center gap-[10px] self-center text-xs">
                        {
                            messageRef.value?.cost?.time ? (<span class="mr-1">{messageRef.value?.cost?.time}s</span>) : ''
                        }
                        {
                            messageRef.value?.cost?.tokens ? (<span>{messageRef.value?.cost?.tokens} Tokens</span>) : ''
                        }
                    </div>
                </div>
            );
        }

        const renderSuggestQuestions = () => {
            return props.message?.suggestQuestions?.length ? (
                <div class="mt-4 flex flex-col gap-2">
                    {
                        props.message?.suggestQuestions?.map(question => (
                            <div class="suggestQuestion w-fit flex items-center gap-1 justify-between" onClick={() => emit('submitChat', question)}>
                                {question}
                                <ChevronRight size={16} />
                            </div>
                        ))
                    }
                </div>
            ) : '';
        }

        const renderProcessTitle = () => {
            const tracing = props.message?.tracing || [];

            if (props.answerLoading && props.isLast) {
                return (
                    <div class="flex items-center pl-[3px]">
                        <svg class="mr-3 -ml-1 size-4 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>   
                        <div class="shiny-text flex items-center gap-2.5">
                            任务进行中
                            <div class="loadingdots flex items-center gap-1.5">
                                <div class="loadingdot"></div>
                                <div class="loadingdot"></div>
                                <div class="loadingdot"></div>
                            </div>
                        </div>
                        {
                            tracing?.length ? (
                                <TextButton onClick={() => collapseProcess.value = !collapseProcess.value}>
                                    <ChevronDown size={18} color="#8f959e" class={['duration-75 transition-all', collapseProcess.value ? 'rotate-0' : 'rotate-180']} />
                                </TextButton>    
                            ) : ''
                        }
                    </div>
                );
            }

            return (
                <div class="flex items-center" style="color: var(--N600)">
                    <CircleCheckBig size={14} strokeWidth={3} color="#237b19"></CircleCheckBig>
                    <span class="ml-2">已完成<span class="text-[#8f959e] text-xs">（{messageRef.value?.cost?.time ? (<span class="mr-1">{parseInt(messageRef.value?.cost?.time)}秒</span>) : ''}）</span></span>
                    <TextButton onClick={() => collapseProcess.value = !collapseProcess.value}>
                        <ChevronDown size={18} color="#8f959e" class={['duration-75 transition-all', collapseProcess.value ? 'rotate-0' : 'rotate-180']} />
                    </TextButton>
                </div>
            );
        }

        const renderToolProcess = () => {
            const process = props.message?.tracing || [];

            if (!process?.length || collapseProcess.value) {
                return '';
            }

            const toolProcess = process.filter(item => item.event === 'tool_message');
            const combinedToolProcessMap = {};

            toolProcess.forEach((item) => {
                const message = combinedToolProcessMap[item.id];

                combinedToolProcessMap[item.id] = {
                    message_title: item.message_title,
                    answer: (message?.answer || '') + item.answer,
                }
            });

            const combinedProcess = Object.keys(combinedToolProcessMap).map((id) => combinedToolProcessMap[id]);

            return combinedProcess.map((item, index) => {
                const showLoading = index === combinedProcess.length - 1 && props.answerLoading;

                return (
                    <div>
                        <div class={['relative flex items-center gap-2 h-[28px] bg-bg-body z-5', index === 0 ? 'mt-1' : 'mt-5']}>
                            {
                                showLoading ? (
                                    <svg width="14px" height="14px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="#8f959e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0"/><path d="M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6"/><path d="M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6"/><circle cx="12" cy="12" r="10"/></svg>
                                ) : (
                                    <svg width="14px" height="14px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" data-icon="YesFilled"><path d="M1 12c0 6.075 4.925 11 11 11s11-4.925 11-11S18.075 1 12 1 1 5.925 1 12Zm14.794-2.674a.994.994 0 0 1 1.405.01.994.994 0 0 1 .01 1.404c-1.888 1.886-3.776 3.77-5.66 5.659a1.001 1.001 0 0 1-1.418 0c-.984-.986-1.97-1.971-2.956-2.956a.993.993 0 0 1 .01-1.403.992.992 0 0 1 1.403-.012l2.252 2.252 4.954-4.954Z" fill="#8f959e"></path></svg>
                                )
                            }
                            
                            <span class={[showLoading ? 'shiny-text' : '']}>{item.message_title}</span>
                        </div>
                        <div class="pl-[22px] flex flex-col relative">
                            <div class="flex flex-col gap-2 mt-2.5">
                                <TraceContent content={item.answer} />
                            </div>
                            {
                                index !== combinedProcess.length - 1 ? (
                                    <div class="absolute left-[6px] -top-0 -bottom-5 w-px bg-n900 z-1"></div>
                                ) : ''
                            }
                        </div>
                    </div>
                );
            })
        }

        return () => (
            <div>
                <div>
                    <div class="mb-6">
                        <div class="mb-3">{renderProcessTitle()}</div>                 
                        <div class="lightText">{renderToolProcess()}</div>
                    </div>

                    {answerComponent.value}
                    {renderActions()}
                    {renderSuggestQuestions()}
                </div>
            </div>
        );
    }
})
</script>

<style>
:root {
    --shiny-text-secondary: #2b2f36;
    --shimmer-contrast: rgba(255, 255, 255, 0.8);
    --shiny-animation-duration: 1800ms;
    --shimmer-color: color-mix(in srgb, var(--shimmer-contrast) 70%, var(--shiny-text-secondary) 30%);
}

:root[data-theme="dark"] {
    --shiny-text-secondary: var(--N500);
}

@keyframes shiny-text {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.shiny-text {
    animation-duration: 1.8s;
    animation-iteration-count: infinite;
    animation-name: shiny-text;
    animation-timing-function: linear;

    background: var(--shiny-text-secondary) linear-gradient(to left, var(--shiny-text-secondary) 0, var(--shimmer-color, var(--shimmer-contrast)) 40%, var(--shimmer-color, var(--shimmer-contrast)) 60%, var(--shiny-text-secondary) 100%);
    -webkit-background-clip: text;
    background-clip: text;
    background-repeat: no-repeat;
    background-size: 50% 200%;
    color: transparent;
    will-change: background-position-x;
}

.bg-n900 {
    background-color: oklab(0.254665 -0.00256238 -0.012503 / 0.1);
}

:root[data-theme="dark"] .bg-n900 {
    background-color: oklab(1 0 0 / 0.1);
}
</style>

<style scoped>
.messageFooter {
    color: var(--message-action-color);
    margin-top: 12px;
}

.actions, .actions svg {
    color: var(--message-action-color);
}
</style>

<style scoped>
.suggestQuestion {
    padding: 0 6px 0 12px;
    border-radius: 8px;
    color: #646a73;
    cursor: pointer;
    font-size: 14px;
    height: 35px;
    line-height: 22px;
    border: 1px solid #dee0e3;
}

.suggestQuestion:hover {
    background: rgba(31,35,41,.08);
}

.loadingdot {
    background-color: var(--N700);
    border-radius: 50%;
    height: 6px;
    width: 6px;
    animation: three-dots-flashing .8s ease infinite alternate;
}

.loadingdots .loadingdot:first-child {
    animation-delay: -.4s;
}

.loadingdots .loadingdot:nth-child(2) {
    animation-delay: -.2s;
}

.loadingdots .loadingdot:nth-child(3) {
    animation-delay: 0s;
}

@keyframes three-dots-flashing {
    0% {
        opacity: 1;
    }
    50% {
        opacity: .1;
    }
    100% {
        opacity: 1;
    }
}
</style>