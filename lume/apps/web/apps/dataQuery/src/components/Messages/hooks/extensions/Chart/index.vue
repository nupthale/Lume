<script lang="tsx">
import { defineComponent, ref, computed } from 'vue';
import { Tooltip } from 'ant-design-vue';
import { TextButton } from '@zsfe/zsui';
import { Download, Fullscreen } from 'lucide-vue-next';

import Segmented from '@/components/Segmented/index.vue';
import Loading from '@/components/Loading/index.vue';

import { themeTokens } from '@/utils/theme.ts';

import Chart from './Chart.vue';
import SourceCode from '../SourceCode/index.vue';
import ChartTypeSwitcher from './ChartTypeSwitcher.vue';

enum TabEnum {
    CHART = 'chart',
    CODE = 'code',
}

const segmentOptions = [
    { label: '图表', value: TabEnum.CHART },
    { label: '代码', value: TabEnum.CODE },
];

export default defineComponent({
    props: {
        config: String,
        query: String,
        rawData: Array,
        chartData: Array,
        showQuery: Boolean,
        showFullscreen: Boolean,
        isFullscreen: Boolean,
        viewType: String,
        specViewType: String,
        spec: Object,
        isComplete: Boolean,
    },
    emits: ['fullscreen', 'switchView'],
    setup(props, { emit }) {
        const crtTabRef = ref(TabEnum.CHART);
        const chartRef = ref<{ download: () => void }>();

        // 如果series有多个type，就禁止切换
        const hasMultipleType = computed(() => {
            const type = props.spec?.series?.[0]?.type;
            return !props.spec?.series?.every(item => item.type === type);
        });

        const handleDownload = () => {
            chartRef.value?.download();
        }

        const handleChartTypeChange = (type: string) => {
            emit('switchView', type)
        }

        const handleFullscreen = () => {
            emit('fullscreen');
        }

        return () => (
            <div class="messageChart">
                <div class="messageChart-actions">
                    <div class="tabWrap">
                        <Segmented
                            size="small"
                            options={segmentOptions} 
                            value={crtTabRef.value}
                            onChange={(val) => crtTabRef.value = val}
                        /> 
                    </div>
                    <div class="flex items-center gap-2 h-[28px]">
                        {
                            props.showFullscreen ? (
                                <Tooltip title="全屏">
                                    <TextButton size="small" onClick={handleFullscreen}>
                                        <Fullscreen size={14} color={themeTokens.lightTextColor()} />
                                    </TextButton>
                                </Tooltip>
                            ) : ''
                        }

                        {
                            props.specViewType !== 'table' ? (
                                <ChartTypeSwitcher hasMultipleType={hasMultipleType.value} type={props.viewType} specType={props.specViewType} onChange={handleChartTypeChange} />
                            ) : ''
                        }

                        <Tooltip title="下载">
                            <TextButton onClick={handleDownload}>
                                <div class="flex items-center">
                                    <Download size={14} color={themeTokens.lightTextColor()} />
                                </div>
                            </TextButton>
                        </Tooltip>
                    </div>
                </div>

                {
                    props.showQuery && props.query ? (
                        <div class="queryContainer flex items-center gap-1">
                            <span>🌿</span>
                            {props.query}
                        </div>
                    ) : ''
                }

                <div class="messageGraph">                   
                    {
                        !props.isComplete ? (
                            <div class="absolute top-0 left-0 right-0 bottom-0 m-auto flex items-center justify-center">
                                <Loading style={{ fontSize: '68px', position: 'relative' }} />
                            </div>
                        ) : ''
                    }
                    
                    <Chart 
                        ref={chartRef} 
                        style={{ display: crtTabRef.value === TabEnum.CHART ? 'block' : 'none'}} 
                        spec={props.spec} 
                        rawData={props.rawData}
                        chartData={props.chartData}
                        viewType={props.viewType}
                        activeTab={crtTabRef.value}
                        config={props.config}
                        isFullscreen={props.isFullscreen}
                    />
                    <div style={{ display: crtTabRef.value === TabEnum.CODE ? 'block' : 'none'}}>
                        <SourceCode lang="json" code={props.config} />
                    </div>
                </div>
            </div>
        )
    }
});
</script>

<style scoped>
.messageChart {
    background: var(--chart-container-bg);
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--table-border-color);
}

.messageChart-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px 6px;
    color: var(--light-text-color);
    height: 36px;

    border-radius: 8px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}

.messageGraph {
    position: relative;
}

.tabWrap :deep(.segmentedWrap) {
    border-width: 0px;
}

.messageChart :deep(.coder-header),
.messageChart :deep(.coder-body) {
    border: none;
}

.queryContainer {
    border-top: 1px solid #dee0e3;
    font-size: 12px;
    padding: 6px 14px 6px;
}
</style>