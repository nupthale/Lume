<script lang="tsx">
import { defineComponent, computed } from 'vue';
import { TextButton } from '@zsfe/zsui';
import { Copy } from 'lucide-vue-next';
import { useClipboard } from '@vueuse/core';

import Prism from 'prismjs';

// 引入需要的语言包
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-json';

import 'prismjs/plugins/line-numbers/prism-line-numbers.js'
import 'prismjs/plugins/line-numbers/prism-line-numbers.css'
import 'prismjs/themes/prism.css';  // 主题样式

export default defineComponent({
    props: {
        code: String,
        lang: String,
    },
    setup(props) {
        const { copy } = useClipboard({
            legacy: true,
        });

        const highlightCode = computed(() => {

            try {
                let code = (props.code || '').trim();

                try {
                    code = JSON.stringify(JSON.parse(code), null, 4);
                } catch {
                    // 不是合法 JSON，保持原样
                    console.error('不是合法 JSON，保持原样');
                }

                return Prism.highlight(code, Prism.languages[props.lang] || Prism.languages.javascript);
            } catch(e) {
                console.error(e);
                return 'code error';
            }
        });

        return () => (
            <div class="coder">
                <div class="coder-header flex items-center justify-between">
                    <div>
                        {props.lang || 'Plain Text'}
                    </div>
                    <div class="coder-actions">
                        <TextButton onClick={() => copy(props.code || '')}>
                            <div class="flex items-center gap-1">
                                <Copy size={14} color="#646a73" />复制
                            </div>
                        </TextButton>
                    </div>
                </div>
                <div class="coder-body overflow-auto">
                    <pre>
                        <code 
                            class={`language-${props.lang}`} 
                            innerHTML={highlightCode.value}
                        />
                    </pre>
                </div>
            </div>
        );
    }
})
</script>

<style scoped>
.coder {
    font-size: 14px;
    line-height: 22px;
    margin-top: 8px;
}

.coder-actions {
    opacity: 0;
}

.coder:hover .coder-actions {
    opacity: 1;
    color: #646a73!important;
}

.coder-header {
    color: #646a73;
    height: 32px;
    padding: 6px 14px 6px;
    border: 1px solid #dee0e3;
    border-bottom: 0px;
    background: var(--N50);
    border-radius: 8px;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
}

.coder-body {
    border: 1px solid #dee0e3;
    border-top: 0px;
    background: var(--N50);
    border-radius: 8px;
    border-top-left-radius: 0;
    border-top-right-radius: 0;

    padding: 0 14px 14px;
    font-family: Menlo,Monaco,Consolas,"Courier New",monospace;
}

.coder-body code[class*="language-"], 
.coder-body pre[class*="language-"] {
    text-shadow: none!important;
}
</style>