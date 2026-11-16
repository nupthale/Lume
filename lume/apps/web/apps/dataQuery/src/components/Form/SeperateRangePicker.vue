<script lang="tsx">
import { defineComponent, PropType } from 'vue';
import { DatePicker, Tooltip } from 'ant-design-vue';
import type { Dayjs } from 'dayjs'; 

import Icon from '@/components/Icon/index.vue';

type ValueType = [Dayjs | undefined, Dayjs | undefined];

export default defineComponent({
    props: {
        value: Array as unknown as PropType<ValueType>,
    },
    emits: ['update:value'],
    setup(props, { emit }) {
        const handleUpdate = (index: number, value?: Dayjs) => {
            const newValue = [...(props.value || [])];
            newValue[index] = value;

            emit('update:value', newValue);
        }

        return () => (
            <div class="flex items-center">
                <div class="inputWrap flex-1 flex items-center">
                    <span class="lightText prefixText">起</span>
                    <DatePicker
                        placeholder="开始日期"
                        value={props?.value?.[0]}
                        onUpdate:value={value => handleUpdate(0, value as Dayjs)}
                    />
                </div>
                <div class="inputWrap flex-1 !ml-1 flex items-center">
                    <span class="lightText prefixText flex items-center">
                        止
                        <Tooltip title="不填，默认2099-12-31">
                            <Icon icon="info_outlined" size="14px" class="ml-1" />
                        </Tooltip>    
                    </span>
                    <DatePicker
                        placeholder="截止日期"
                        value={props.value?.[1]}
                        onUpdate:value={value => handleUpdate(1, value as Dayjs)}
                    />
                </div>
                
            </div>
        );
    }
});
</script>

<style scoped>
.inputWrap {
    border: 1px solid #d9d9d9;
    border-radius: 6px;
    background: #fff;
}

.inputWrap :deep(.ant-picker) {
    border: none!important;
    box-shadow: none!important;
}

.prefixText {
    margin-left: 10px;
}
</style>