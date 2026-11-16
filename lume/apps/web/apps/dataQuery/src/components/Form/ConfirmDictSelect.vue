<script setup lang="ts">
  import { getConfigQueryConfigList } from '@/api/dataQuery/configQuery'

  import ApiSelect from './ApiSelect.vue';

  const props = defineProps({
    code: String,
    value: String,
  });

  const emit = defineEmits(['update:value']);
</script>

<template>
  <ApiSelect
    style="width: 100%"
    :api="getConfigQueryConfigList"
    labelKey="name"
    valueKey="code"
    :extraParams="{key: code}"
    :virtual="true" 
    :value="value"
    @update:value="(val, option) => emit('update:value', val, option)"
  />
</template>