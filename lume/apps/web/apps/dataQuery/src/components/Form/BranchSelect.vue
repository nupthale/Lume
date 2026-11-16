<script setup lang="ts">
import ApiSelect from './ApiSelect.vue';

import { getBranchList } from '@/api/sys/user';

defineProps({
    value: String,
    api: Function,
});

const emit = defineEmits(['update:value', 'change']);

const handleUpdate = (val, option) => {
    emit('update:value', val, option),
    emit('change', val, option);
}

const handleFilterOption = (inputValue, option) => {
    return option.label?.includes(inputValue);
}
</script>

<template>
    <ApiSelect
        :api="api || getBranchList"
        :extraParams="{}"
        :filterOption="handleFilterOption"
        :parseResult="(result) => result || []"
        searchKey="name"
        labelKey="name"
        valueKey="id"
        :value="value"
        @update:value="handleUpdate"
    >
    </ApiSelect>
</template>

<style scoped>
</style>