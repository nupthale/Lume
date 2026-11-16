<script lang="tsx">
import { defineComponent } from 'vue';
import { Modal, Space } from 'ant-design-vue';
import { TextButton } from '@zsfe/zsui';

import Icon from '@/components/Icon/index.vue';

export default defineComponent({
    props: {
        title: String,
        headerHeight: Number,
    },
    setup(props, { slots, attrs }) {
        return () => (
            <Modal
                {...attrs}
                width="100%"
                footer={null}
                closable={false}
                mask={false}
                wrapClassName="customFullscreenModal"
            >
                <div class="wrap">
                    <div class="header" style={{ height: `${props.headerHeight ?? 55}px` }}>
                        {slots.header ? slots.header() : (
                            <>
                                <Space align="center">
                                    {{
                                        split: () => (
                                            <div class="divider"></div>
                                        ),
                                        default: () => (
                                            <>
                                                <TextButton class="mt-0.5" onClick={attrs.onCancel}>
                                                    <Icon icon="arrow-down_outlined" size="16px" style="transform: rotate(180deg)"></Icon>
                                                </TextButton>
                                                {
                                                    slots.title ? slots.title() : (
                                                        <div class="title">
                                                            {props.title || '-'}
                                                        </div>
                                                    )
                                                }
                                            </>
                                        )
                                    }}
                                </Space>
                                {slots.actions?.()}
                            </>
                        )}
                    </div>
                    <div class="body" style={{ marginTop: `${props.headerHeight ?? 55}px` }}>
                        {slots.default && slots.default()}
                    </div>
                </div>
            </Modal>
        );
    }
});
</script>

<style scoped>
.wrap {
    height: 100%;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    background: var(--home-sider-bg);
}

.header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
    background: var(--blur-bg-filter);
    padding: 0 30px 0 10px;
    backdrop-filter: saturate(1.5) blur(16px);
    /* box-shadow: var(--fullscreen-modal-header-shadow); */
    border: 1px solid var(--default-border-color);

}

.body {
    flex: 1;
    overflow: hidden;
    background: var(--body-bg);
}

.title {
    font-weight: 500;
    font-size: 16px;
}

.divider {
    width: 1px;
    height: 18px;
    background: var(--N400);
    margin: 0 8px;
}

</style>