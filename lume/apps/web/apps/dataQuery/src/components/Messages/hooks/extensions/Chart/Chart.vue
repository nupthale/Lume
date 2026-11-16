<script lang="tsx">
import { defineComponent, onMounted, ref, PropType, watch, computed } from 'vue';
import * as echarts from 'echarts/core';
import { storeToRefs } from 'pinia';
import * as XLSX from 'xlsx';

import { useThemeStore } from '@/store/ui-states/theme';

import './echart';
import Table from './Table.vue';

export default defineComponent({
    props: {
        spec: Object as PropType<Record<string ,any>>,
        rawData: Array,
        chartData: Array,
        viewType: String,
        activeTab: String,
        config: String,
        isFullscreen: Boolean,   
    },
    setup(props, { expose }) {
        const containerRef = ref();
        const chartRef = ref<echarts.ECharts | null>(null);

        const themeStore = useThemeStore();
        const { isDark } = storeToRefs(themeStore);

        // const { extendUserProps } = useExtendChartProps();
        
        const extendProps = computed(() => props.spec as any);

        const crtViewType = ref(props.viewType);

        watch(() => isDark.value, () => {
            createChart();
        });

        const createChart = () => {
            if (!containerRef.value) {
                return;
            }

            try {
                chartRef.value?.dispose();

                let spec = extendProps.value || {};

                if (props.viewType) {
                    spec.series?.forEach(item => {
                        item.type = props.viewType || item.type;
                    })
                }

                chartRef.value = echarts.init(containerRef.value, isDark.value ? 'dark' : 'light');
                chartRef.value.setOption(spec);
                
            } catch(e) {
                console.error(e);
            }
        }

        const exportTableData = () => {
            try {
                const dataSource = props.spec?.data?.values || props.spec?.data || [];

                if (!Array.isArray(dataSource) || dataSource.length === 0) {
                    return;
                }

                const worksheet = XLSX.utils.json_to_sheet(dataSource);

                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');

                XLSX.writeFile(workbook, `数据导出_${new Date().getTime()}.xlsx`)

            } catch (error) {
                console.log('导出失败', error);
            }
        };

        const exportJSON = () => {
            const blob = new Blob([props.config || ''], { type: 'application/json'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `config_${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
        }

        onMounted(() => {
            createChart();
        });

        watch(() => [props.viewType], () => {
            crtViewType.value = props.viewType || props.spec?.type;
            
            setTimeout(() => {
                if (props.viewType !== 'table') {
                    createChart();
                } else {
                    chartRef.value?.dispose();
                }
            }, 0)
        });

        expose({
            download: () => {
                if (props.activeTab === 'code') {
                    exportJSON();
                    return;
                }

                if (props.viewType === 'table') {
                    exportTableData();
                } else {
                    if (chartRef.value) {
                        const dataURL = chartRef.value.getDataURL({
                            type: 'png',
                            pixelRatio: 2,
                            backgroundColor: '#fff' // 解决透明背景变黑的问题
                        });

                        const a = document.createElement('a');
                        a.href = dataURL;
                        a.download = `${props.spec?.title?.text || 'chart'}.png`;
                        a.click();
                    }
                }
            }
        })

        return () => (
            <div class="chartWrap">
                {
                    crtViewType.value === 'table' ? (
                        <Table spec={props.spec} isFullscreen={props.isFullscreen} rawData={props.rawData}></Table>
                    ) : (
                        <div class="chartContainer my-0 mx-auto" ref={containerRef}></div>
                    )
                }
            </div>
        )
    }
})
</script>

<style scoped>
.chartWrap {
    margin-bottom: -1px;
    background: var(--body-bg);
}

.chartWrap :deep(table) {
    margin-bottom: 0!important;
}

.chartContainer {
    height: 420px;
}
</style>