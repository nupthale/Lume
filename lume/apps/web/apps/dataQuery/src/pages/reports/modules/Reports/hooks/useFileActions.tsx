import { Modal } from 'ant-design-vue';

import { ReportTemplate } from '@/api/dataQuery/interface';

import { defHttp } from "@/utils/http/axios";

export const useFileActions = (refetch?: () => void) => {
    const handleCreateReport = () => {}

    const handleDeleteReport = (file: ReportTemplate) => {
        Modal.confirm({
            title: '删除',
            content: () => <div>确定要删除<span class="font-bold underline">{file.templateName}</span>吗？</div>,
            okText: '删除',
            okType: 'danger',
            cancelText: '取消',
            centered: true,
            onOk: async () => {
                try {
                    await defHttp.delete({
                        url: `/data-query-api/data/reportDetail/delete?id=${file.id}`,
                    })

                    refetch?.();
                } catch(e) {
                    console.error(e);
                }
            }
        });
    }

    return {
        handleCreateReport,
        handleDeleteReport,
    };
}