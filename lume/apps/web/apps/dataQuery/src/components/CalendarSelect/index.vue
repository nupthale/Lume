<script setup lang="ts">
import { ref, toRef, PropType, computed } from 'vue';
import { DatePicker } from 'ant-design-vue';
import { onClickOutside } from '@vueuse/core'
import { TextButton } from '@zsfe/zsui';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs'; 

import Icon from '@/components/Icon/index.vue';

const containerRef = ref();

const dateDropdownOpen = ref(false);

const props = defineProps({
    picker: {
        type: String as PropType<typeof DatePicker.picker>,
        default: 'year',
    },
    value: String,
    disabledDate: Function as PropType<(val: Dayjs) => boolean>,
});

const emit = defineEmits(['update:value']);

onClickOutside(containerRef, () => {
    dateDropdownOpen.value = false;
});

const date = toRef(props, 'value');;

const handleToggle = () => {
    dateDropdownOpen.value = !dateDropdownOpen.value;
}

const handleChange = (value) => {
    emit('update:value', value);
    dateDropdownOpen.value = false;
}

const getPopupContainer = () => containerRef.value;

const textRef = computed(() => {
    if (props.picker === 'year') {
        return dayjs(date.value).format('YYYY年');
    }

    if (props.picker === 'month') {
        return dayjs(date.value).format('YYYY年MM月');
    }
})
</script>

<template>
    <div ref="containerRef" class="header-calendar" >
        <TextButton class="header-calendarBtn" @click="handleToggle">
            <Icon class="calendar-icon" icon="calendar-line_outlined" />
            <span>{{ textRef }}</span>
            <Icon class="calendar-icon -rotate-90 ml-2" icon="left_outlined" />
            <DatePicker 
                v-if="dateDropdownOpen" 
                class="header-calendar-picker" 
                :bordered="false" 
                :picker="picker" 
                :open="dateDropdownOpen" 
                :getPopupContainer="getPopupContainer" 
                @change="handleChange"
                :disabledDate="disabledDate"
            />
        </TextButton>
    </div>
</template>

<style>
.header-calendar .ant-picker-input input {
    cursor: pointer !important;
}
</style>

<style scoped lang="less">
.header-calendar {
    display: inline-flex;
    position: relative;

    .header-calendarBtn {
        display: flex;
        align-items: center;
        gap: 8px;

        font: 500 24px/32px 'DINPro-Medium';
    }

    .header-calendarBtn:active {
        background: var(--float-border-color)!important;
    }

    .calendar-icon {
        font-size: 18px;
    }

    .header-calendar-picker {
        position: absolute;
        top: 0;
        left: 0;
        opacity: 0;
    }
}
</style>