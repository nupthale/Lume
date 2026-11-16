<script lang='tsx'>
import { defineComponent, computed, ref, onBeforeMount } from 'vue';
import { Table } from 'ant-design-vue';

// 1. 获取文字像素宽度（模拟页面字体14px，和ant默认一致）
const getTextWidth = (text): number => {
  if(text === null || text === undefined) text = ''
  const span = document.createElement('span')
  span.style.visibility = 'hidden'
  span.style.whiteSpace = 'nowrap'
  span.innerText = text
  document.body.appendChild(span)
  const w = span.offsetWidth as number;
  document.body.removeChild(span)
  return w + 28 // +左右padding(14*2)，ant单元格默认内边距
}


export default defineComponent({
    props: {
        rawData: Array,
        isFullscreen: Boolean,
    },
    setup(props) {
        const columns = ref<{
            title: string;
            key: string;
            dataIndex: string;
        }[]>([]);

        // 根据dataSource和columns计算每一列的宽度
        const getColumnWidth = (key: string) => {
            const titleWidth = getTextWidth(key);
            let maxValuesWidth = titleWidth;

            const values = props.rawData || [];

            values?.forEach((row: any) => {
                const width = getTextWidth(row[key]);

                if (width > maxValuesWidth) {
                    maxValuesWidth = width;
                }
            });

            return maxValuesWidth;
        }

        onBeforeMount(() => {
            const values = props.rawData || [];

            // 从values中提取key作为标题
            const titles = Object.keys(values[0] ||  {}).map(itemKey => itemKey);

            columns.value = titles.map((title) => ({
                title, 
                key: title, 
                dataIndex: title,
                width: getColumnWidth(title),
                slots: {
                    customRender: 'text',
                },
                sorter: (prev, next) =>  prev?.[title] - next?.[title]
            }))
        });

        const dataSource = computed(() => props.rawData || []);

        return () => (
            <div class="tableChart overflow-x-auto">
                <Table
                    size="small"
                    tableLayout='fixed'
                    scroll={{ y: props.isFullscreen ? undefined : 540 }}
                    columns={columns.value} 
                    dataSource={dataSource.value}
                    pagination={false}
                >
                    {{
                        text: ({ text }) => {
                            return text;
                        }
                    }}
                </Table>
            </div>
        );
    }
})
</script>

<style scoped>
</style>