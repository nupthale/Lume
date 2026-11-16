<script setup lang="ts">
import { useSlots } from 'vue';

defineProps({
  illustration: String,
  title: String,
  message: String,
});

const slots = useSlots();
</script>

<template>
  <div class="empty">
    <div v-if="illustration" class="empty-illustration">
      <img :src="illustration" width="120" height="120" />
    </div>
    <div v-if="title" class="empty-title">{{title}}</div>
    <div v-if="message" class="empty-message">{{message}}</div>
    <div v-if="slots['buttons']" class="empty-btns">
      <slot name="buttons" />
    </div>
  </div>
</template>

<style scoped lang="less">
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty-illustration {
  margin-bottom: 16px;
}

.empty-title {
  margin-bottom: 12px;
  font-size: 16px;
  line-height: 24px;
}

.empty-message {
  max-width: 262px;
  color: #646a73;
  font-size: 14px;
  font-weight: 400;
  line-height: 22px;
  text-align: center;
}

.empty-btns {
  margin-top: 16px;
}
</style>