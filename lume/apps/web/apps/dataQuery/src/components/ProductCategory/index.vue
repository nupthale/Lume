<script setup lang="ts">
defineProps({
    code: String,
    text: String,
});

const colorMap = {
    // 资管产品
    1: '#fff3e5',
    // 公募基金
    2: '#fee3e2',
    // 私募基金
    3: '#f5f0fe',
    // 其他产品
    4: '#f2f3f5',
    // 银行理财
    5: '#fed6ae',
    // 信托产品
    6: '#f9d0e7',
    // 场内ETF
    7: '#e3d4fd',
    // 场内LOF
    8: '#faedc2',

};
</script>

<template>
   <div class="tag" :style="{ backgroundColor: colorMap[code!] || '#f2f3f5' }" v-if="text">{{ text }}</div>
   <div v-else></div>
</template>

<style scoped>
.tag {
    display: inline-flex;
    align-items: center;

    height: 24px;
    line-height: 24px;
    border-radius: 4px;
    white-space: nowrap;
    padding: 0 6px;
    color: #000;
}
</style>

