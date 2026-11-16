<script lang="tsx">
import { defineComponent, computed, ref, PropType } from 'vue';
import { Input, Button, message } from 'ant-design-vue';

import { isNil } from 'lodash-es';

import { sendUserMessage$ } from '@/store/subscriptions/agent/observables/index';
import ConfirmDictSelect from '@/components/Form/ConfirmDictSelect.vue';

export default defineComponent({
    props: {
        questions: Array as PropType<{ query: string, confirm_question: any[] }[]>,
        isLast: Boolean,
    },
    setup(props) {
        const answers = ref<({ text?: string, value: any }[])[]>([]);

        const confirmQuestionsRef = computed(() => {
            try {
                const confirmQuestions = props.questions || [];
                // 过滤掉没有confirmQuestion的项目
                return confirmQuestions.filter(item => !!item.confirm_question?.length);
            } catch(e) {
                return [];
            }
        });

        const renderQuestion = (question, queryIndex, questionIndex) => {
            answers.value[queryIndex] = answers.value[queryIndex] || [];
            const queryItem: { text?: string, value: any }[] = answers.value[queryIndex];

            if (question.type === 'select') {
                return (
                    <ConfirmDictSelect
                        code={question.dict}
                        placeholder={props.isLast ? '请选择' : '已选择'}
                        value={queryItem[questionIndex]?.value}
                        onUpdate:value={(val, option) => {
                            queryItem[questionIndex] = {
                                text: option.label,
                                value: val,
                            };
                        }}
                        disabled={!props.isLast}
                     />
                );
            }

            return (
                <Input 
                    placeholder={props.isLast ? '请输入文本' : '已输入文本'}
                    value={queryItem[questionIndex]?.value}
                    onChange={(e) => {
                        queryItem[questionIndex] = {
                            value: e.target.value ?? '',
                        }
                    }}
                    allowClear
                    disabled={!props.isLast}
                />
            );
        }

        const validate = () => {
            let valid = true;

            confirmQuestionsRef.value.forEach((item, queryIndex) => {
                item.confirm_question?.forEach((_, index) => {
                    const answer = answers.value[queryIndex]?.[index]?.value;
                    
                    if (isNil(answer) || !`${answer}`?.length) {
                        valid = false;
                    }
                })
            });

            return valid;
        }

        const handleSubmit = () => {
            try {
                // 拼装问题和答案
                let answerSummary: string[] = [];

                if (!validate()) {
                    throw Error('校验失败');
                }

                confirmQuestionsRef.value.forEach((item, queryIndex) => {
                    item.confirm_question?.forEach((question, index) => {
                        const answer = answers.value[queryIndex]?.[index];

                        if (answer.text) {
                            answerSummary.push(`${question.question}: \n${answer.text}（编号：${answer.value}）`)
                        } else {
                            answerSummary.push(`${question.question}: \n${answer.value}`)
                        }
                    })
                });

                answerSummary.push('请按上述补充继续回答');

                sendUserMessage$.next({
                    message: answerSummary.join('\n'),
                })
            } catch(e) {
                message.error('校验失败，请检查');
                console.error(e);
            }
        }

        return () => (
            <div class="questionWrap">
                    <div class="flex items-center gap-3">
                        <div class="botIcon flex items-center justify-center">🌀</div>
                        <div class="questionBlockTitle">
                            请回答待确认问题
                        </div>
                    </div>
                    <div class="flex flex-col gap-2">
                        {
                            confirmQuestionsRef.value?.map((item, queryIndex) => (
                                <div>
                                    <div class="font-bold my-2">{item.query || '问题'}</div>
                                    <div class="flex flex-col gap-2">
                                        {
                                            item.confirm_question?.map((question, index) => (
                                                <div>
                                                    <div class="mb-1">
                                                        {question.question}
                                                    </div>
                                                    <div>
                                                        {renderQuestion(question, queryIndex, index)}
                                                    </div>
                                                </div>
                                            ))
                                        }
                                    </div>
                                </div>
                            ))
                        }
                    </div>
                    {
                        props.isLast ? (
                            <div class="mt-6">
                                <Button block type="primary" onClick={handleSubmit}>确认</Button>
                            </div>
                        ) : ''
                    }
                </div>
        );
    }
});
</script>

<style scoped>
.questionWrap {
    border: 1px solid #dee0e3;
    border-radius: 10px;
    padding: 14px;
    width: 362px;
    font-size: 14px;
}

.botIcon {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: rgb(248, 249, 250);
    border: 1px solid #dee0e3;
}

.questionBlockTitle {
    color: rgb(31, 35, 41);
}
</style>