<script lang="tsx">
import { defineComponent } from 'vue';
import { Dropdown, Menu } from 'ant-design-vue';
import { TextButton } from '@zsfe/zsui';
import { Ellipsis, FileCode2, FileJson2, TextSearch, FileDigit, Trash2 } from 'lucide-vue-next';
import i18next from 'i18next';

import { exportToJSON$, exportToMarkdown$, exportToPDF$, searchPanel$ } from '@editor/Editor/event';

const MenuItem = Menu.Item;

export default defineComponent({
    props: {
        fileId: String,
    },
    emits: ['deleteFile'],
    setup(props, { emit }) {
        const handleDeleteFile = (fileId: string) => {
            emit('deleteFile', fileId);
        }

        const renderActionOverlay = () => {
            return (
                <div class="dropdownContainer min-w-[180px] max-w-[360px]">
                    {/* 受控模式，selectedKeys 永远为空，点击后不会保持选中态 */}
                    <Menu activeKey='-1' selectedKeys={[]}>
                        <div class="px-[3px]">
                            <MenuItem key="1" onClick={() => exportToPDF$.next({ fileId: props.fileId! })}>
                                <div class="flex items-center gap-2">
                                    <FileDigit size={16} strokeWidth="2.2" style="color: var(--N600)" />{i18next.t('export.pdf')}
                                </div>
                            </MenuItem>

                            <MenuItem key="2" onClick={() => exportToMarkdown$.next({ fileId: props.fileId! })}>
                                <div class="flex items-center gap-2">
                                    <FileCode2 size={16} strokeWidth="2.2"  style="color: var(--N600)" />{i18next.t('export.markdown')}
                                </div>
                            </MenuItem>
                            <MenuItem key="3" onClick={() => exportToJSON$.next({ fileId: props.fileId! })}>
                                <div class="flex items-center gap-2">
                                    <FileJson2 size={16} strokeWidth="2.2" style="color: var(--N600)" />{i18next.t('export.json')}
                                </div>
                            </MenuItem>
                        </div>
                        <div class="divider"></div>
                        <div class="px-[3px]">
                            <MenuItem key="4" onClick={() => searchPanel$.next({ fileId: props.fileId! })}>
                                <div class="flex items-center gap-2">
                                    <TextSearch size={16} strokeWidth="2.2" style="color: var(--N600)" />查找和替换
                                </div>
                            </MenuItem>
                            <MenuItem key="5" onClick={() => handleDeleteFile(props.fileId!)}>
                                <div class="flex items-center gap-2">
                                    <Trash2 size={16} strokeWidth="2.2" style="color: var(--N600)" />删除
                                </div>
                            </MenuItem>
                        </div>
                    </Menu>
                </div>
            );
            }

        return () => (
           <Dropdown placement='bottomRight' trigger="click">
                {{
                default: () => (
                    <TextButton>
                        <Ellipsis size={24} />
                    </TextButton>
                ),
                overlay: () => (
                    <div>
                        {renderActionOverlay()}
                    </div>
                ),
                }}
            </Dropdown>
        );
    }
});
</script>

<style scoped>
.divider {
    height: 1px;
    margin: 4px 0;
    background: var(--doclist-border-color);
}
</style>