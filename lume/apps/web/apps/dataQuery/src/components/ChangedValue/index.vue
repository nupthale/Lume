<script setup lang="ts">
    import { computed } from 'vue';
    import { isNil } from 'lodash-es';
    import Icon from '@/components/Icon/index.vue';

    import { formatCount } from '@/utils/number';
    import { multiply } from '@/utils/mathCalc';

    const props = defineProps({
        value: String,
        type: String,
    });

    const numValue = computed(() => Number(props.value));
</script>

<template>
    <template v-if="type === 'percent'">
        <span v-if="!isNil(numValue) && numValue > 0" class="count count--rise">+{{ formatCount(multiply(numValue, 100)) }}<span class="percent">%</span><Icon icon="expand-up_filled" size="12px"></Icon></span>
        <span v-else-if="!isNil(numValue) && numValue < 0" class="count count--fall">{{ formatCount(multiply(numValue, 100)) }}<span class="percent">%</span><Icon icon="expand-down_filled" size="12px"></Icon></span>
        <span v-else-if="!isNil(numValue) && numValue === 0" class="lightCount">0<span class="percent">%</span></span>
        <span v-else class="lightCount">-</span>
    </template>
    <template v-else>
        <span v-if="!isNil(numValue) && numValue > 0" class="count count--tag count--rise">+{{ formatCount(numValue) }}<Icon icon="expand-up_filled" size="12px"></Icon></span>
        <span v-else-if="!isNil(numValue) && numValue < 0" class="count count--tag count--fall">{{ formatCount(numValue) }}<Icon icon="expand-down_filled" size="12px"></Icon></span>
        <span v-else-if="!isNil(numValue) && numValue === 0" class="lightCount">0</span>
        <span v-else class="lightCount">-</span>
    </template>
</template>

<style scoped>
.lightCount {
    color: #bbbfc4;
}

.count {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.count--rise {
    color: #00A742;
}

.count--fall {
    color: #F13D3B;
}

.percent {
   font-size: 12px; 
   color: #bbbfc4; 
}

.count--tag {
    padding: 2px 8px;
    border-radius: 4px;
}

.count--tag.count--fall {
    background-color: #ffe6eb;
}

.count--tag.count--rise {
    background-color: #D9F3E8;
}
</style>