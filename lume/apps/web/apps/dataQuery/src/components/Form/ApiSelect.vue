<script lang="tsx">
import { defineComponent, ref, onMounted } from 'vue';
import { Select, SelectOption } from 'ant-design-vue';
import { Subject, switchMap, tap } from 'rxjs';

import { useSubscription } from '@vueuse/rxjs'

export default defineComponent({
    props: {
        value: String,
        api: Function,
        searchKey: {
            type: String,
            default: 'searchKey',
        },
        labelKey: {
            type: String,
            default: 'label',
        },
        valueKey: {
            type: String,
            default: 'value',
        },
        parseResult: Function,
        extraParams: Object,
    },
    emits: ['update:value'],
    setup(props, { slots, emit }) {
        const { api, searchKey, labelKey, valueKey, parseResult, extraParams } = props;

        const fetch$ = new Subject();
        const options = ref<any[]>([]);

        const getParams = (searchText) => {
            return {
                [searchKey]: searchText,
                ...(extraParams || {}),
            };
        }

        useSubscription(
            fetch$.pipe(
                switchMap(async (searchText) => {
                    try {
                        if (!api) return;

                        const { result } = await api(getParams(searchText));

                        if (parseResult) {
                            return parseResult(result);
                        }

                        return result || [];
                    } catch(e) {
                        return [];
                    }
                }),
                tap(result => {
                    options.value = result.map(item => ({
                        label: item[labelKey],
                        value: item[valueKey],
                        _raw: item,
                    }));
                })
            ).subscribe()
        );

        onMounted(() => {
            if (props.value) {
                fetch$.next(props.value);
            } else {
                fetch$.next('');
            }
        });

        const handleSearch = (searchText) => fetch$.next(searchText);

        const handleUpdateValue = (val) => {
            const option = options.value?.find(item => item.value === val);

            emit('update:value', val, option);
        };

        return () => (
            <Select
                virtual={false}
                filterOption={false} 
                onSearch={handleSearch} 
                placeholder="请输入搜索" 
                optionLabelProp="children"
                allowClear
                autoClearSearchValue
                showSearch
                value={props.value}
                onUpdate:value={handleUpdateValue}
            >
                {
                    options.value.map(option => (
                        <SelectOption key={option.value} value={option.value} label={option.label}>
                            {
                                slots.default ? slots.default({ option }) : option.label
                            }
                        </SelectOption>
                    ))
                }
            </Select>
        )
    }
});
</script>