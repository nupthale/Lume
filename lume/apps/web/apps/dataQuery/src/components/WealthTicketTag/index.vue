<script setup lang="ts">
defineProps({
    code: String,
});

const map = {
    1: {
        color: '#fff3e5',
        text: '尊享券',
    }
};

</script>

<template>
   <div class="tag" :style="{ backgroundColor: map[code!]?.color || '#f2f3f5' }" v-if="code">{{ map[code!]?.text || '-' }}</div>
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

