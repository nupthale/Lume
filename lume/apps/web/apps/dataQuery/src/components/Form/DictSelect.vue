<script setup lang="ts">
  import { computed } from 'vue';
  import { isEmpty} from 'lodash-es';
  import { Select } from 'ant-design-vue';
  import { storeToRefs } from 'pinia';

  import { useUserStore } from '@/store/modules/user';

  const props = defineProps({
    code: String,
    filterValues: Array<String>,
  });

  const userStore = useUserStore();
  const { dictItems } = storeToRefs(userStore);

  const options = computed(() => {
    if (isEmpty(dictItems.value)) return [];

    const list = dictItems.value?.[props.code!] || [];
    return list.filter((item) => {
      if(props.filterValues?.length){
        return props.filterValues.includes(String(item.value)) 
      }

      return true
    })
  });
</script>

<template>
  <Select :options="options" :virtual="false"></Select>
</template>