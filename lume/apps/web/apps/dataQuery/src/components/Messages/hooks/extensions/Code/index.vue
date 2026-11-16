<script lang="tsx">
import { defineComponent, ref, watchEffect } from 'vue';

import VisChart from '../Chart/entry.vue';
import VisIdChart from '../Chart/VisIdChart.vue';
// import Confirm from '../Confirm/index.vue';

export default defineComponent({
    props: {
        code: String,
        lang: String,
        isLast: Boolean,
        viewType: String,
    },
    emits: ['updateViewType'],
    setup(props, { emit }) {
        const isCompleteRef = ref(false);
        const jsonArrRef = ref([]);

        watchEffect(() => {
            try {
                const jsonArr = JSON.parse(props.code || '');

                jsonArrRef.value = jsonArr || [];
                
                isCompleteRef.value = true;
            } catch(e) {
                isCompleteRef.value = false;
            }
        });

        const renderChartItem = (item, showQuery) => {
            if (item.result?.includes('vis-chart')) {
                const regex = /```vis-chart\s*([\s\S]*?)```/gi;
                const match = regex.exec(item.result);
                const code = match?.[1]?.trim() || '';

                // 大模型生成的config里的数据是被slice的sample， 不全， rawData是原始后端返回数据， chartData是经过pivot后的数据
                return <VisChart config={code} query={item.query} rawData={item.rawData} chartData={item.chartData} showQuery={showQuery} />;
            } else {
                return item.result;
            }
        }

        const renderBlock = () => {
            if (!isCompleteRef.value) {
                return (
                    <div>
                        <div class="flex items-center !mb-6">
                            <svg width="14px" height="14px" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="#8f959e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0"/><path d="M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6"/><path d="M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6"/><circle cx="12" cy="12" r="10"/></svg>
                            <span class="ml-2 lightText">图表生成中...</span>
                        </div>
                    </div>
                );
            }

            if (props.lang === 'vis-data') {
                // 返回的code的格式是: [{query: '', result: '```vis-chart.....```'}, {query: "", result: '接口报错'}, {query: "", result: '````vis-confirm...```'}]
                try {
                    const len = jsonArrRef.value?.length;

                    // 如果任意一个包含vis-confirm, 先confirm， 然后全部都confirm后再一起输出chart
                    // const confirms = 
                    //     jsonArr.map(itemStr => isJsonString(itemStr) ? JSON.parse(itemStr || '') : itemStr)
                    //             .filter(item => {
                    //                 return item.result?.includes('vis-confirm');
                    //             }).map(item => {
                    //                 const regex = /```vis-confirm\s*([\s\S]*?)```/gi;
                    //                 const match = regex.exec(item.result);
                    //                 const code = match?.[1]?.trim() || '';

                    //                 return {
                    //                     query: item.query,
                    //                     confirm_question: JSON.parse(code || ''),
                    //                 }
                    //             });

                    // if (confirms.length) {
                    //     return <Confirm questions={confirms} isLast={props.isLast} />;
                    // }

                    return (
                        <div class="flex flex-col gap-4">
                            {
                                jsonArrRef.value?.map(item => {
                                    return renderChartItem(item, len > 1);
                                })
                            }
                        </div>
                    )
                } catch(e) {
                    console.error(e);
                    return 'json解析出错';
                }
            } else if (props.lang === 'vis-id') {
                return <VisIdChart dataId={props.code} viewType={props.viewType} onUpdateViewType={viewType => emit('updateViewType', viewType)} />;
            }

            return props.code;
        }

        return () => renderBlock();
    }
})
</script>

<style scoped>
</style>