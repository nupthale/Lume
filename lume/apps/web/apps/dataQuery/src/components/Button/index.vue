<script setup lang="ts">
defineProps({
    size: {
        type: String,
        default: 'md',
    },
    type: {
        type: String,
        default: 'neutral',
    },
});
</script>

<template>
    <div :class="['btn', `btn--${size}`, `btn--${type}`]">
        <slot />
    </div>
</template>

<style scoped lang="less">
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    cursor: pointer;
   
    background: none;

    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.btn {
    &--md {
        padding: 8px;
        height: 32px;
        line-height: 32px;
    }
}

.btn {
    &--neutral {
        border: 1px solid rgb(208, 211, 214);
        color: #646a73;

        &:hover {
            border-color: rgb(51, 112, 255);
            color: rgb(51, 112, 255);
            background: rgba(51, 112, 255, 0.08);
        }
    }

    &--primary {
        border: 1px solid rgb(51, 112, 255);
        color: rgb(51, 112, 255);

        &:hover {
            background: rgba(51, 112, 255, 0.08);
        }
    }

    &--danger {
        border: 1px solid rgb(245, 74, 69);
        color: rgb(245, 74, 69);

        &:hover {
            background: #fde2e2;
        }
    }
}
</style>