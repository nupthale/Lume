<script lang="tsx">
import { defineComponent, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { Modal, Form, Space, Button, message, Input, Checkbox } from 'ant-design-vue';

import IndicatorSelect from '../IndicatorSelect/index.vue';

import { useMetricsStore } from '@/store/ui-states/metrics/index';
import { usePermissionStore } from '@/store/modules/permission';
import { updateMetricsConfig$ } from '@/store/queries/idx/useMetricsConfig';
import { postConfigAddSceneInfo, postConfigUpdateSceneInfo } from '@/api/dataQuery/configQuery';
import { SYSTEM_SET } from '../../interface';

const FormItem = Form.Item;

export default defineComponent({
    props: {
        open: {
            type: Boolean,
            default: false
        },
    },
    setup() {
        const permissionStore = usePermissionStore();

        const store = useMetricsStore();
        const { metricsConfigModalForm, metricsModalVisible } = storeToRefs(store);

        const formRef = ref();

        const errorFields = ref<string[]>([]);

        const validate = async (_rule, value): Promise<void> => {
            if (!value?.length) {
                return Promise.reject('请选择指标');
            }

            return Promise.resolve();
        };

        const validateRules = ref({
            sceneName: [{ required: true, message: '请输入名称' }],
            fieldRelationVOList: [{ validator: validate, trigger: 'change' }],
        });

        const handleOk = async () => {
            try {
                await formRef.value.validate();
                errorFields.value = [];

                const api = metricsConfigModalForm.value?.sceneCode ? postConfigUpdateSceneInfo : postConfigAddSceneInfo;

                await api({
                    ...metricsConfigModalForm.value
                });

                message.success('保存成功');

                updateMetricsConfig$.next({});
                handleCancel();
            } catch(e) {
                if (e.errorFields?.length) {
                    errorFields.value = e.errorFields?.map(item => item.name[0]);
                }

                console.error(e);
            }
        };

        const handleCancel = () => {
            store.setMetricsConfigModalForm({})
            store.setMetricsModalVisible(false);
        };

        return () => (
            <Modal 
                title={metricsConfigModalForm.value?.sceneCode ? '编辑指标组' : '添加指标组'}
                open={metricsModalVisible.value}
                class="wideTableModal"
                width={'800px'} 
                style={{top: '40px'}}
                forceRender
                destroyOnClose
                onCancel={handleCancel}
            >
                {{
                    default: () => (
                        <div class="modalBodyContainer mt-4">
                            <Form
                                class="flex-1 flex flex-col h-full" 
                                ref={formRef} 
                                model={metricsConfigModalForm.value} 
                                // @ts-ignore
                                rules={validateRules.value}
                            >
                                <div class="flex items-center py-3 gap-2">
                                    <FormItem noStyle name="sceneName" autoLink={false}>
                                        <Input 
                                            v-model:value={metricsConfigModalForm.value.sceneName}
                                            placeholder="请输入名称"
                                        >
                                            {{
                                                prefix: () => <div style="color: var(--light-text-color)">名称</div>
                                            }}
                                        </Input>
                                    </FormItem>
                                    <FormItem noStyle name="matchTexts" autoLink={false}>
                                        <Input 
                                            v-model:value={metricsConfigModalForm.value.matchTexts}
                                            placeholder="请输入别名，多个别名请用英文逗号隔开"
                                        >
                                            {{
                                                prefix: () => <div style="color: var(--light-text-color)">别名</div>
                                            }}
                                        </Input>
                                    </FormItem>
                                </div>
                               
                                <div class="flex items-center py-3 flex-shrink-0">
                                    <FormItem noStyle name="matchDesc" autoLink={false}>
                                        <Input 
                                            v-model:value={metricsConfigModalForm.value.matchDesc}
                                            placeholder="请输入描述"
                                        >
                                            {{
                                                prefix: () => <div style="color: var(--light-text-color)">描述</div>
                                            }}
                                        </Input>
                                    </FormItem>
                                </div>
                                {
                                    permissionStore.hasPermission('operate:system_set') ? (
                                        <div class="flex items-center pt-3 pb-4 flex-shrink-0 cursor-pointer" onClick={() => {
                                            metricsConfigModalForm.value.sysPreset = metricsConfigModalForm.value?.sysPreset == SYSTEM_SET.YES ? SYSTEM_SET.NO : SYSTEM_SET.YES; 
                                        }}>
                                            <FormItem noStyle name="sysPreset" autoLink={false}>
                                                <Checkbox
                                                    checked={metricsConfigModalForm.value?.sysPreset == SYSTEM_SET.YES}
                                                ></Checkbox>
                                                <span class="ml-2">系统预置</span>
                                            </FormItem>
                                        </div>
                                    ) : ''
                                }

                                <div class="flex-1 flex flex-col overflow-hidden">
                                    <div class="mt-2 mb-4 sectionTitle text-[14px] flex-shrink-0">指标</div>

                                    <div class="flex-1 overflow-hidden">
                                        <FormItem noStyle name="fieldRelationVOList" autoLink={false}>
                                            <IndicatorSelect
                                                class={errorFields.value?.includes('fieldRelationVOList') ? 'error' : ''}
                                                value={metricsConfigModalForm.value?.fieldRelationVOList}
                                                onUpdate:value={value => metricsConfigModalForm.value.fieldRelationVOList = value}
                                            ></IndicatorSelect>
                                        </FormItem>
                                    </div>
                                </div>
                            </Form>
                        </div>
                    ),
                    footer: () => (
                        <div class="footer">
                            <Space>
                                <Button onClick={() => handleCancel()}>取消</Button>
                                <Button type="primary" onClick={handleOk}>提交</Button>
                            </Space>
                        </div>
                    )
                }}
            </Modal>
        );
    }
});
</script>

<style>
.ant-modal.wideTableModal .ant-modal-content {
    background: var(--model-sider-headbg) var(--bg-float-2, var(--blur-bg, #ffffff));
    backdrop-filter: var(--drawer-filter);
}

.ant-modal.wideTableModal .ant-modal-header {
    background: none !important;
}
</style>

<style scoped>
.modalBodyContainer {
    height: 70vh;
    border-radius: 6px;
    overflow: hidden;
}

.title {
    font-size: 16px;
    font-weight: 600;
}

.footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-top: 20px;
}
</style>