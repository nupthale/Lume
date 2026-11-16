<script lang="tsx">
import { defineComponent, ref, toRefs, watch } from 'vue';
import { Form, FormItem, Button, Space } from 'ant-design-vue';


import { componentMap } from './componentMap';

import propsDef from './props';
import { QueryFormSchema } from './types';

export default defineComponent({
    props: propsDef,
    emits: ['search', 'change'],
    setup(props, { emit }) {
        const formState = ref({ ...(props.values || {}) });
        const { items } = toRefs(props);

        const handleSearch = () => {
            emit('search', { ...formState.value });
        }

        const handleChange = () => {
            emit('change', { ...formState.value });
        }

        const handleReset = () => {
            const value = { ...props.initialValue, _isReset: true };

            formState.value = value;
            emit('search', { ...value });
        }

        watch(formState, handleChange, { deep: true });

        const renderComponent = (item: QueryFormSchema) => {
            const FormComp = componentMap.get(item.component);

            if (!FormComp) return '';

            const { component, field, valueField, componentProps } = item;

            const isCheck = component && ['Switch', 'Checkbox'].includes(component);

            const ons = {
                onChange: (...args: Nullable<Recordable>[]) => {
                    const [e] = args;
        
                    const target = e ? e.target : null;
                    const value = target ? (isCheck ? target.checked : target.value) : e;

                    formState.value['_isReset'] = false;

                    formState.value[field] = value;
                },
            };

            const bindValue: Recordable = {
                [valueField || (isCheck ? 'checked' : 'value')]: formState.value[field],
            };

            const children = isCheck ? [item.label] : [];
        
            const props = {
                ...componentProps,
                ...bindValue,
                ...ons,
            };

            return (
                // @ts-ignore
                <FormComp 
                    {...props} 
                    style={{ flex: 1 }} 
                >
                    {...children}
                </FormComp>
            );
        }

        const isCheckbox = (item: QueryFormSchema) => {
            return item.component === 'Checkbox';
        }

        return () => (
            <Form model={formState} noStyle>
                <div class="queryFormContainer">
                    <div class="queryFormFlatContainer">
                        {
                            items.value.map(item => (
                                <div class={['queryFormItem', 'overflow-hidden', isCheckbox(item) ? 'noStyle' : '']} style={{ width: `${item.width}px`, maxWidth: `${item.width}px` }}>
                                    {
                                        !isCheckbox(item) ? (
                                            <div class="queryFormItemLabel">{ item.label }</div>
                                        ) : ''
                                    }
                                    <FormItem noStyle>
                                        { renderComponent(item) }
                                    </FormItem>
                                </div>
                            ))
                        }
                    </div>

                    {
                        props.showButtons ? (
                            <Space>
                                <Button onClick={handleSearch}>查询</Button>
                                <Button onClick={handleReset}>重置</Button>
                            </Space>
                        ) : ''
                    }
                </div>
            </Form>
        )
    }
});
</script>

<style lang="less">
.queryFormCollapsePopover {
    .ant-popover-inner {
        border-radius: 8px;
        overflow: hidden;
    }

    .ant-popover-content {
        box-shadow: none;
    }

    .ant-popover-inner-content {
        padding: 0;
    }
}

.queryFormFlatContainer {
    .ant-input, .ant-picker, .ant-input-affix-wrapper {
        border: none!important;
        box-shadow: none!important;
    }

    .ant-select {
        overflow: hidden;
    }

    .ant-select-selector {
        height: 30px!important;
        border: none!important;
        box-shadow: none!important;
    }
}
</style>   

<style scoped lang="less">
.queryFormContainer {
    display: flex;
    align-items: center;
}

.queryFormFlatContainer {
    display: flex;
}

.queryFormCollapseContainer {
    display: flex;
    width: 360px;
    flex-direction: column;
    padding: 18px;

    border-radius: 8px;

    max-height: 300px;
    overflow-y: auto;
}

.queryFormItem {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    height: 32px;
    min-width: 220px;
    margin-right: 8px;

    padding: 0px 7px;

    border: 1px solid rgb(208, 211, 214);
    border-radius: 6px;
    background: #fff;
}

.queryFormItem.noStyle {
    border: none;
    background: none;
}

.queryFormItemLabel {
    white-space: nowrap;
    flex-wrap: nowrap;
}

.queryFormItem--collapse {
    flex-direction: column;
}

.queryFormMoreBtn {
    height: 24px;
}
</style>