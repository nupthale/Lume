<script setup lang="ts">
import { EllipsisText } from '@zsfe/zsui';

defineProps({
    text: String,
    highlightText: String,
});
</script>

<template>
    <EllipsisText :title="text" v-if="text && highlightText && text?.includes(highlightText)">
        <span>{{ text.substring(0, text.indexOf(highlightText)) }}</span>
        <span style="color: #f50">{{ highlightText }}</span>
        <span>{{ text.substring(text.indexOf(highlightText) + highlightText.length) }}</span>
    </EllipsisText>
    <EllipsisText :title="text" v-else>{{ text }}</EllipsisText>
</template>