<script lang="tsx">
import { defineComponent } from 'vue';
import { storeToRefs } from 'pinia';
import { Button, Input } from 'ant-design-vue';
import { Blend, FilePlus2, Search } from 'lucide-vue-next';
import { TextButton } from '@zsfe/zsui';
import { useRouter } from 'vue-router';

import { updateTemplates$ } from '@/store/queries/report/useTemplates.tsx';
import { updateReports$ } from '@/store/queries/report/useReports.tsx';

import { useReportsStore } from '@/store/ui-states/reports/index';
import { postDatareportAdd } from '@/api/dataQuery/dataReport.ts';
import { postDataReportDetailAdd } from '@/api/dataQuery/dataReportDetail.ts';

import Reports from './modules/Reports/index.vue';
import Templates from './modules/Templates/index.vue';
import AddReportModal from './modules/AddReportModal/index.vue';

export default defineComponent({
  setup() {
    const router = useRouter();

    const reportsStore = useReportsStore();
    const { tab, searchText } = storeToRefs(reportsStore);

    const handleCreateReportByTemplate = () => {
        reportsStore.setAddReportModalVisible(true);
    };

    const handleCreateTemplate = async () => {
        try {
            let { result } = await postDatareportAdd({});

            router.push(`/template/${result}`);

            // 更新列表
            updateTemplates$.next({});
        } catch(e) {
            console.error(e);
        }
    };

    const handleCreateReport = async () => {
        try {
            let { result } = await postDataReportDetailAdd({});

            router.push(`/report/${result}`);

            // 更新列表
            updateReports$.next({});
        } catch(e) {
            console.error(e);
        }
    }

    return () => (
      <div class="wrap">
        <div class="docs-head flex items-center justify-between">
            <div class="flex items-center gap-4">
                <TextButton class={['docs-title', tab.value === 1 ? 'active' : '']} size="large" onClick={() => reportsStore.setTab(1)}>报告</TextButton>
                <TextButton class={['docs-title', tab.value === 2 ? 'active' : '']} size="large" onClick={() => reportsStore.setTab(2)}>模板</TextButton>
            </div>
            <div class="flex items-center gap-2">
                <div>
                    <Input 
                        placeholder="关键字搜索" 
                        style="width: 260px" 
                        prefix={<Search width={20} color="#646a73" />} 
                        value={searchText.value}
                        onChange={e => reportsStore.setSearchText(e.target.value)}    
                    />
                </div>
                <div style="height: 32px;">
                    {
                        tab.value === 1 ? (
                            <div class="flex items-center gap-2">
                                <Button class="createDocBtn createDocBtn-blank" type="primary" onClick={handleCreateReport}>
                                    <div class="flex items-center">
                                        <FilePlus2 class="mr-1" width="18" height="18" />
                                        创建空白报告
                                    </div>    
                                </Button>
                                <Button class="createDocBtn createDocBtn-template" type="primary" onClick={handleCreateReportByTemplate}>
                                <div class="flex items-center">
                                    <Blend class="mr-1" width="18" height="18" />
                                    使用模板创建
                                </div>
                            </Button>
                            </div>
                        ) : (
                            <Button class="createDocBtn createDocBtn-template" type="primary" onClick={handleCreateTemplate}>
                                <div class="flex items-center">
                                    <Blend class="mr-1" width="18" height="18" />
                                    创建模板
                                </div>
                            </Button>
                        )
                    }
                </div>
            </div>
        </div>
        {
            tab.value === 1 ? (
                <Reports />
            ) : (
                <Templates />
            )
        }

        <AddReportModal />
      </div>
    );
  }
});
</script>

<style scoped lang="less">
.wrap {
    height: 100%;
    overflow: hidden;
    border-left: 1px solid var(--home-sider-borderRight);
    background: var(--body-bg);
    background-image: url('@/assets/homebg3.png');
    background-position: 50%;
    background-repeat: no-repeat;
    background-size: cover;
}

:root[data-theme="dark"] .wrap {
    background: var(--chat-messages-bg);
}

.list-row:hover + .list-row::before {
    background: var(--body-bg);
}

.docs-head {
    position: sticky;
    top: 0;
    z-index: 1;

    padding: 18px 24px 12px 28px;
    font-size: 20px;
    // font-weight: 500;
    border-bottom: 1px solid var(--default-border-color);
}

.docs-title {
    font-size: 20px!important;
    padding: 6px!important;

    transition: color .3s ease;
}

.docs-title.active {
    color: var(--primary-text-color)!important;
    font-weight: 500;
}

.docs-footer {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 0;
    text-align: center;
    color: #8f959e;
}

.docs-footer:before {
    display: inline-flex;
    content: "";
    height: 1px;
    width: 5%;
    background: linear-gradient(90deg, #8f959e00, #8f959e);
}

.docs-footer:after {
    display: inline-flex;
    content: "";
    height: 1px;
    width: 5%;
    background: linear-gradient(90deg, #8f959e, #8f959e00);
}

.docs-empty, .docs-loading {
    text-align: center;
    margin: 100px auto;
    width: 400px;
    left: 0;
    right: 0;
}

.docs-empty_illustration {
    display: flex;
    justify-content: center;
}

.docs-empty_text {
    color: #646a73;
}

.docTag {
    color: #646a73;
    font-size: 12px;
}

.createDocBtn {
    padding: 4px 10px 4px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    box-shadow: none;
    outline: none;
}

.createDocBtn-blank {
    color: var(--createBlankDocBtn-color);
    background: var(--createBlankDocBtn-bg);
}

.createDocBtn-blank:hover {
    color: rgb(46, 109, 233);
    background: rgba(2, 82, 243, 0.24);
}

.createDocBtn-template {
    color: var(--createTemplateDocBtn-color);
    background: var(--createTemplateDocBtn-bg);
}

.createDocBtn-template:hover {
    color: rgb(94, 2, 210);
    background: rgba(94, 2, 210, 0.12);
}
</style>