<script lang="tsx">
import { defineComponent, ref } from 'vue';
import { TextButton } from '@zsfe/zsui';
import { Copy } from 'lucide-vue-next';
import { Tooltip } from 'ant-design-vue';
import { useClipboard } from '@vueuse/core';

export default defineComponent({
    setup(_, { slots }) {
        const containerRef = ref();

        const { copy } = useClipboard({
            legacy: true,
        });

        const handleCopy = () => {
            if (!containerRef.value) {
                return;
            }

            const $table = containerRef.value.querySelector('table');

            if (!$table) return;

            const rows: HTMLTableRowElement[] = Array.from($table.rows);
            const lines = rows.map((row) => {
                const cells = Array.from(row.cells);
                // 用 innerText 取纯文本，用 \t 拼接单元格
                return cells.map(cell => cell.innerText.trim()).join('\t');
            });
            const text = lines.join('\n');
            copy(text);
        }

        return () => (
            <div class="messageTable" ref={containerRef}>
                <div class="messageTable-actions gap-1">
                    <Tooltip title="复制">
                        <TextButton onClick={handleCopy}>
                            <div class="flex items-center">
                                <Copy size={14} color="#646a73" />
                            </div>
                        </TextButton>
                    </Tooltip>
                </div>
                <div>
                    {slots.default?.()}
                </div>
            </div>
        );
    }
})
</script>

<style scoped>
.messageTable {
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
}

.messageTable-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 4px 0 4px 14px;

    border-radius: 8px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
} 
</style>