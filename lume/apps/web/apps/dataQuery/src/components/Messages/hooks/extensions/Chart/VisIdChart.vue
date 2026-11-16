<script lang="tsx">
import { defineComponent, onMounted, ref } from 'vue';

import { getAiExtDataContent } from '@/api/agent/index';

import VisChart from './entry.vue';

export default defineComponent({
    props: {
        dataId: String,
        viewType: String,
    },
    emits: ['updateViewType'],
    setup(props, { emit }) {
        const configRef = ref();
        const chartData = ref<any[]>([]);
        const specRef = ref();

        const getData = async () => {
            if (!props.dataId) return;

            try {
                const result = await getAiExtDataContent({
                    dataId: props.dataId,
                });

                const configArr = result.data?.result;

                if (!configArr?.length) return {};

                const config = configArr?.[0];

                chartData.value = config?.chartData || [];

                const regex = /```vis-chart\s*([\s\S]*?)```/gi;
                const match = regex.exec(config?.result);
                specRef.value = match?.[1]?.trim() || '';

                configRef.value = config;
            } catch(e) {
                console.error(e);
            }
        }
        
        onMounted(() => {
            getData();
        });


        return () => configRef.value ? (
            <div>
                <VisChart 
                    config={specRef.value} 
                    query={configRef.value?.query} 
                    rawData={configRef.value?.rawData} 
                    chartData={chartData.value} 
                    viewType={props.viewType}
                    onUpdateViewType={viewType => emit('updateViewType', viewType)}
                />
            </div>
        ) : '';
    }
})
</script>