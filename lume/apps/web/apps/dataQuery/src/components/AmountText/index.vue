<script lang="tsx">
import { defineComponent } from 'vue';
import { formats } from '@/utils/tableFormats';

export default defineComponent({
    props: {
        value: String,
        unit: String,
    },
    setup(props) {
        return () => (
            <div class="inline-flex items-baseline">
                {formats.amount({ text: props.value })}
                {
                    props.unit? <span class="lightText text-xs ml-1">{props.unit}</span> : ''
                }
            </div>
        );
    },
});
</script>
