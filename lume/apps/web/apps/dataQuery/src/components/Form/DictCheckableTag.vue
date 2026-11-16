<script setup lang="ts">
  import { computed } from 'vue';
  import { isEmpty} from 'lodash-es';
  import { TextButton } from '@zsfe/zsui';
  import { CheckableTag } from 'ant-design-vue';
  import { storeToRefs } from 'pinia';

  import { useUserStore } from '@/store/modules/user';

  const props = defineProps({
    code: String,
    filterValues: Array<String>,
    colCount: Number,
    tagStyle: {
      type: Object,
    },
    value: {
      type: Array,
      default: () => []
    },
    multiple: {
      type: Boolean,
      default: true,
    },
  });

  const emit = defineEmits(['update:value']);

  const userStore = useUserStore();
  const { dictItems } = storeToRefs(userStore);

  const options = computed(() => {
    if (isEmpty(dictItems.value)) return [];

    const array = dictItems.value?.[props.code!] || [];
    return array.filter((item) => {
      if (props.filterValues?.length) {
        return props.filterValues.includes(`${item.value}`);
      }

      return true;
    });
  });

  const isChecked = (option) => {
    return props.value.includes(option.value);
  }

  const handleChange = (option, checked) => {
    let value = props.multiple ? [...props.value] : [];
    if (checked) {
      value.push(option.value);
    } else {
      value = value.filter((item) => item !== option.value);
    }

    emit('update:value', value);
  }

  const handleSelectAll = () => {
    emit('update:value', options.value.map((item) => item.value));
  }

  const handleDeselectAll = () => {
    emit('update:value', []);
  }
</script>

<template>
  <div :style="{ marginTop: multiple ? '-32px' : '0' }">
    <div class="flex items-center justify-end mb-2" v-if="multiple">
      <TextButton size="small" v-if="value?.length < options.length" @click="handleSelectAll">全选</TextButton>
      <TextButton size="small" v-if="value?.length === options.length" @click="handleDeselectAll">清空</TextButton>
    </div>
    <div :class="['grid', 'flex-wrap', `grid-cols-${colCount}`, 'gap-1']">
      <CheckableTag
        class="checkableTag"
        :style="tagStyle" 
        v-for="option in options" 
        :key="option.value" 
        :virtual="false"
        :checked="isChecked(option)"
        @change="(checked) => handleChange(option, checked)"
      >
        {{ option.label || '-' }}
      </CheckableTag>
    </div>
  </div>
</template>

<style scoped>

.checkableTag {
  padding: 4px 0;
  height: 28px!important;
  background: #1f232914;
  border-radius: 6px;
}

.checkableTag.ant-tag-checkable-checked {
  background: #1456f033;
  color: #002270;
}
</style>