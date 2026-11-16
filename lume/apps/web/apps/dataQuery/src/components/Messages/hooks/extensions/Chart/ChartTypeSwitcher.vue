<script lang="tsx">
import { defineComponent, ref } from 'vue';
import { TextButton } from '@zsfe/zsui';
import { ChartColumnBig, ChartLine, ChartPie, Sheet, ChevronDown, ChartNoAxesCombined } from 'lucide-vue-next';
import { Dropdown, Menu } from 'ant-design-vue';

import { themeTokens } from '@/utils/theme';

const MenuItem = Menu.Item;

const chartTypeText: Record<string, string> = {
    'bar': '柱状图',
    'line': '折线图',
    'table': '表格',
    'pie': '饼图',
};

export default defineComponent({
    props: {
        hasMultipleType: Boolean,
        type: String,
        specType: String,
    },
    emits: ['change'],
    setup(props, { emit }) {
        const crtViewType = ref<string>(props.type!);

        const handleSwitchType = (type: string) => {
            crtViewType.value = type;

            emit('change', type);
        }

        /**
         * 目前仅支持：
         * 1. 柱形图、条形图（折线图）、表格
         * 2. 饼图、表格
         * 这2组转换
         */
        const renderMenus = () => {
            const typeToMenu = (type: string) => {
                return (
                    <MenuItem key={type} onClick={() => handleSwitchType(type)}>
                        <div class={['wrap flex items-center gap-2 h-[20px] w-[100px]', type === crtViewType.value ? 'active' : '']}>
                            {renderChartIcon(type, type === crtViewType.value)}
                            <div style="line-height: 0">{chartTypeText[type!]}</div>
                        </div>
                    </MenuItem>
                );
            }

            console.info('####', props.hasMultipleType, props.specType)
            if (props.hasMultipleType) {
                 return [props.specType!, 'table'].map((type) => typeToMenu(type));
            }

            if (['bar', 'line'].includes(props.specType!)) {
                return ['bar', 'line', 'table'].map((type) => typeToMenu(type));
            }

            if (props.specType === 'pie') {
                return ['pie', 'table'].map((type) => typeToMenu(type));
            }
        }

        const renderChartIcon = (type: string, active: boolean = false) => {
            const chartCompMap = {
                'bar': ChartColumnBig,
                'line': ChartLine,
                'table': Sheet,
                'pie': ChartPie,
            };

            const Comp = chartCompMap[type];
            
            if (!Comp) {
                return '';
            }

            return <Comp size={14} stroke={active ? themeTokens.primaryTextColor() : themeTokens.lightTextColor()} />
        }

        return () => (
            <Dropdown getPopupContainer={(node) => node.parentElement || document.body}>
                {{
                    overlay: () => (
                        <div class="overlay">
                            <Menu selectedKeys={[crtViewType.value]}>
                                {renderMenus()}
                            </Menu>
                        </div>
                    ),
                    default: () => (
                        <div class="flex items-center">
                            <TextButton class="text-sm">
                                <div class="wrap flex items-center gap-1 h-[20px]">
                                    {renderChartIcon(crtViewType.value)}
                                    <div style="line-height: 0">{chartTypeText[crtViewType.value!]}</div>

                                    <ChevronDown size={14} stroke="#646a73" />
                                </div>
                            </TextButton>
                        </div>
                    )
                }}
            </Dropdown>
            
        );
    }
});
</script>

<style scoped>
.wrap {
    font-size: 12px;
}

.wrap.active {
    color: var(--primary-text-color);
}
</style>