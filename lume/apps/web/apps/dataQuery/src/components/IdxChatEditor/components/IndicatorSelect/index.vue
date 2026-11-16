<script lang="tsx">
import { defineComponent, ref, PropType, computed, toRef } from 'vue';
import { useDebounceFn, useInfiniteScroll } from '@vueuse/core';

import { Checkbox, Input, TreeSelect, TreeSelectProps } from 'ant-design-vue';
import { TextButton, EllipsisText } from '@zsfe/zsui';
import { Search } from 'lucide-vue-next';

import { useDomainIdxList } from '@/store/queries/idx/useDomainIdxList';
import { useDomains } from '@/store/queries/idx/useDomains';

import HighlightText from '@/components/HighlightText/index.vue';
import Empty from '@/components/Empty/index.vue';
import imgNoContent from '@/assets/images/noContent.png';

import { useCheckAll } from '../../hooks/useCheckAll';

export default defineComponent({
    props: {
        value: {
            type: Array as PropType<any[]>,
            default: []
        },
    },
    emits: ['update:value'],
    setup(props, { emit }) {
        const scrollContainerRef = ref<HTMLElement | null>(null);
        const displayCount = ref(20);

        const displayIndicators = computed(() => {
            return (indicators.value || []).slice(0, displayCount.value);
        })

        useInfiniteScroll(
            scrollContainerRef,
            () => {
                if (displayCount.value < indicators.value?.length || 0) {
                    displayCount.value += 20;
                }
            },
            { distance: 50 }
        );

        const searchText = ref('');
        const searchDomainCode = ref('');

        const checkedIds = computed(() => props.value?.map(item => item.fieldCode));

        const { data: indicators } = useDomainIdxList(searchText, searchDomainCode);

        const { domains } = useDomains();

        const options = computed<TreeSelectProps['treeData']>(() => {
            return domains.value?.map(firstLevel => {
                return {
                    label: firstLevel.domainName,
                    value: firstLevel.domainCode,
                    children: (firstLevel.secondBizDomainDraftList || []).map(secondLevel => {
                        return {
                            label: secondLevel.domainName,
                            value: secondLevel.domainCode,
                        }
                    })
                }
            }) || [];
        });

        // 可选列表
        const selectableList = computed(() => {
            return indicators.value?.filter(item => item?.dimension.length > 0);
        });

        const { checkAll, checkAllIndeterminate, handleCheckAll } = useCheckAll(
            toRef(props, 'value'),
            selectableList, 
            checkedIds, 
            (value) => {
                emit('update:value', value);
            }
        );

        const handleSearch = useDebounceFn((e) => {
            searchText.value = e.target.value || '';
        }, 300);

        const handleDomainChange = (val) => {
            searchDomainCode.value = val || '';
        };
        
        const handleCheck = (item) => {
            if (!item || !item.dimension?.length) return;

            const checked = checkedIds.value?.includes(item?.fieldCode);
            if (checked) {
                // 反选
                emit('update:value', props.value?.filter(i => item.fieldCode !== i?.fieldCode));
            } else {
                // 选择
                const newValue = [
                    ...(props.value || []),
                    item,
                ];
                emit('update:value', newValue);
            }
        }

        const handleClear = () => {
            emit('update:value', []);
        }

        const handleRemoveItem = (field) => {
            emit('update:value', props.value?.filter(item => item.fieldCode !== field?.fieldCode));
        }

        return () => (
            <div class="indicatorSelect h-full">
                <div class="indicator__left">
                    <div class="indicator__leftHead">
                        <Input
                            placeholder="搜索指标" 
                            value={searchText.value} 
                            allowClear
                            onInput={(e) => handleSearch(e)}
                            class="mb-2"
                        >
                            {{
                                suffix: () => <Search style="color: var(--light-text-color)" size={16} />
                            }}
                        </Input>

                        <TreeSelect
                            showSearch
                            allowClear
                            placeholder="搜索业务域"
                            treeData={options.value}
                            treeDefaultExpandAll
                            treeNodeFilterProp='label'
                            onChange={((val) => handleDomainChange(val))}
                        />

                        {
                            indicators.value?.length ? (
                                <div class="pl-1 pt-2">
                                    <Checkbox 
                                        indeterminate={checkAllIndeterminate.value} 
                                        checked={checkAll.value} 
                                        onChange={() => handleCheckAll()}
                                    /> <span class="ml-1.5">全选</span>
                                </div>
                            ) : ''   
                        }
                    </div>

                    <div ref={scrollContainerRef} class="overflow-y-auto h-[400px]">
                        {
                            !indicators.value?.length ?  
                            <div style="margin-top: 100px">
                                <Empty illustration={imgNoContent} message="暂无数据" />
                            </div> 
                            :
                            displayIndicators.value.map((item) => {
                                return (
                                    <div class="product" key={item.fieldCode} onClick={() => handleCheck(item)}>
                                        <div class="mr-2">
                                            <Checkbox checked={checkedIds?.value?.includes(item.fieldCode)} disabled={!item.dimension || !item?.dimension?.length}/>
                                        </div>
                                        <div class="flex-1 overflow-hidden">
                                            <div class="flex items-center">
                                                <HighlightText text={item.name} highlightText={searchText.value}  />
                                            </div>
                                            <div class="flex gap-2 items-baseline overflow-hidden flex-1">
                                                <div class=" mt-1 flex-shrink-0">
                                                    {
                                                        item.dimension?.length ? (
                                                            <div class="itemDimensionTag">
                                                                {item.dimension?.join('/')}
                                                            </div>
                                                        ) : ''
                                                    }
                                                </div>
                                                <div class="lightText flex-1 overflow-hidden">
                                                    <HighlightText text={item.caliber} highlightText={searchText.value}  />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })
                        }
                    </div>
                </div>
                <div class="indicator__right">
                    <div class="indicator__rightHead">
                        <span class="lightText">已选：{props.value?.length || 0} 项</span>
                        <TextButton type="primary" size="small" onClick={handleClear}>清空</TextButton>
                    </div>

                    {
                        props.value?.map(field => (
                            <div class="product" key={field.fieldCode}>
                                <div class="flex-1 overflow-hidden">
                                    <div class="flex items-center justify-between">
                                        <div>
                                            <div>{field?.name || '-'}</div>
                                            <div class="flex gap-2 items-baseline">
                                                <div class="mt-1 flex-shrink-0">
                                                    {
                                                        field.dimension?.length ? (
                                                            <div class="itemDimensionTag">
                                                                {field.dimension?.join('/')}
                                                            </div>  
                                                        ) : ''
                                                    }
                                                </div>

                                                {
                                                    field?.caliber ? (
                                                        <EllipsisText title={field.caliber}>
                                                            <div class="text-sm itemDesc">{field.caliber}</div>
                                                        </EllipsisText>
                                                    ) : ''
                                                }
                                            </div>
                                        </div>
                                        <TextButton class="product__action" type="warning" size="small" onClick={() => handleRemoveItem(field)}>删除</TextButton> 
                                    </div>
                                </div>
                            </div>
                        ))
                    }

                    {
                        !props.value?.length ? (
                            <div style="margin-top: 100px">
                                <Empty illustration={imgNoContent} message="请选择" />
                            </div>
                        ) : ''
                    }
                </div>
            </div>
        )
    }
});
</script>

<style scoped>
.indicatorSelect :deep(.anticon-search) {
    vertical-align: baseline;
}

.indicatorSelect :deep(.ant-input-affix-wrapper-status-error) {
    border-color: var(--float-border-color)!important;
}

.indicatorSelect {
    display: flex;
    border: 1px solid var(--float-border-color);
    border-radius: 6px;
    overflow: hidden;

    min-height: 445px;
}

.indicatorSelect.error {
    border-color: #e6655a;
}

.indicator__left {
    display: flex;
    flex-direction: column;

    width: 50%;
    padding: 0 0 12px 0;
    border-right: 1px solid var(--float-border-color);
    overflow-y: auto;
}

.indicator__right {
    flex: 1;
    padding: 0 0 12px 0;
    overflow-x: hidden;
    overflow-y: auto;
}

.lightText {
    font-size: 12px;
    color: #646A73;
}

.product {
    display: flex;
    padding: 4px 12px;
    margin: 2px 4px;
    border-radius: 6px;
    cursor: pointer;
}

.product:hover {
    background: var(--fill-color);
}

.product__action {
    display: none;
}

.product:hover .product__action {
    display: block;
}

.indicator__leftHead, .indicator__rightHead {
    position: sticky;
    top: 0;
    padding: 12px 12px 6px;
    z-index: 1;
}

.indicator__rightHead {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.itemDimensionTag {
    width: fit-content;

    font-size: 10px;
    padding: 2px 4px;
    background: var(--N200);
    border-radius: 4px;
}
</style>