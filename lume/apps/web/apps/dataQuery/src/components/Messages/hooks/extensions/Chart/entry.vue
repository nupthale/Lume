<script lang="tsx">
import { defineComponent, ref, computed, watchEffect, PropType } from 'vue';

import { EChartsOption } from 'echarts';

import FullscreenModal from '@/components/FullscreenModal/index.vue';

import { parseConfigWithFunctions } from '@/utils/util.ts';

import Chart from './index.vue';

type ChartDataType = Record<string, string | number> & {
    metric: string;
    value: string;
}

type CommonChartDataType = {
    id: string;
    type: 'bar' | 'line';
    values: ChartDataType[];
}

export default defineComponent({
    props: {
        config: String,
        query: String,
        rawData: Array as PropType<Record<string, string | number>[]>,
        chartData: Array as PropType<ChartDataType[] | CommonChartDataType[]>,
        showQuery: Boolean,
        viewType: String,
    },
    emits: ['updateViewType'],
    setup(props, { emit }) {
        const isFullscreen = ref(false);

        const isCompleteRef = ref(false);
        const specRef = ref<EChartsOption | undefined>(undefined);
        const selectViewTypeRef = ref<string>(props.viewType || '');

        const viewTypeRef = computed(() => {
            return selectViewTypeRef.value || specViewTypeRef.value;
        });

        const specViewTypeRef = computed(() => {
            // 表格才有外层的type
            if (specRef.value?.type === 'table') {
                return 'table';
            }

            return specRef.value?.series?.[0]?.type;
        });

        watchEffect(() => {
            try {
                // 把字符串当作 JS 表达式执行，支持函数、箭头函数
                const spec = parseConfigWithFunctions(props.config);

                specRef.value = spec;
                
                isCompleteRef.value = true;
            } catch(e) {
                isCompleteRef.value = false;
            }
        });

        const handleChartTypeChange = (type: string) => {
            selectViewTypeRef.value = type;
            emit('updateViewType', type);
        }


        return () => isFullscreen.value ? (
            <FullscreenModal
                headerHeight={56}
                destroyOnClose
                open={true}
                onCancel={() => isFullscreen.value = false}
            >
                {{
                    title: () => (
                        <div>{specRef.value?.title?.text || '全屏图表'}</div>
                    ),
                    default: () => (
                        <div class="h-full max-w-[1400px] mx-auto py-6 overflow-hidden fullscreenChart">
                            <Chart
                                config={props.config}
                                query={props.query}
                                rawData={props.rawData}
                                chartData={props.chartData}
                                showQuery={props.showQuery}
                                isFullscreen={true}
                                onSwitchView={handleChartTypeChange}
                                viewType={viewTypeRef.value}
                                specViewType={specViewTypeRef.value}
                                spec={specRef.value}
                                isComplete={isCompleteRef.value}
                            />
                        </div>
                    )
                }}
            </FullscreenModal>
        ) : (
            <Chart
                showFullscreen={true}
                config={props.config}
                query={props.query}
                rawData={props.rawData}
                chartData={props.chartData}
                showQuery={props.showQuery}
                onFullscreen={() => isFullscreen.value = true}
                onSwitchView={handleChartTypeChange}
                viewType={viewTypeRef.value}
                specViewType={specViewTypeRef.value}
                spec={specRef.value}
                isComplete={isCompleteRef.value}
            />
        );
    }
})
</script>

<style scoped>


.fullscreenChart :deep(.messageChart) {
    display: flex;
    flex-direction: column;

    height: 100%;
    overflow: hidden;
}

.fullscreenChart :deep(.messageGraph) {
    flex: 1;
    overflow: hidden;
}

.fullscreenChart :deep(.chartWrap), .fullscreenChart :deep(.chartContainer) {
    height: 100%;
}
</style>