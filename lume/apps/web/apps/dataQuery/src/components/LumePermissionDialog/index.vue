<template>
    <!--
        lume daemon 权限审批弹窗（新增能力，不属于原远程接口功能）。
        自包含组件：自行订阅 daemon 事件流，仅出现 permission_request 时渲染，
        允许/拒绝经 IPC 写回 daemon，不改动任何原有界面元素。
    -->
    <div v-if="request" class="lume-permission-mask">
        <div class="lume-permission-card">
            <div class="lume-permission-title">是否允许执行此操作？</div>
            <div class="lume-permission-tool">{{ request.tool || '工具调用' }}</div>
            <div v-if="request.reason" class="lume-permission-reason">{{ request.reason }}</div>
            <pre v-if="formattedArgs" class="lume-permission-args">{{ formattedArgs }}</pre>
            <div class="lume-permission-actions">
                <button class="lume-permission-btn lume-permission-deny" @click="respond(false)">拒绝</button>
                <button class="lume-permission-btn lume-permission-allow" @click="respond(true)">允许</button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';

import { hasLumeBridge, onEvent, permissionResponse } from '@/core/lume/client';
import type { DaemonEvent } from '@/types/lume';

const props = defineProps<{
    /** 仅响应该会话的权限请求；不传则不过滤 */
    conversationId?: string;
}>();

type PermissionRequestEvent = Extract<DaemonEvent, { type: 'permission_request' }>;

const request = ref<PermissionRequestEvent | null>(null);
let stopListening: (() => void) | null = null;

if (hasLumeBridge()) {
    stopListening = onEvent((eventConversationId, event) => {
        if (event.type !== 'permission_request') return;
        if (props.conversationId && eventConversationId !== props.conversationId) return;
        // 同一时间只展示最新一个请求，daemon 侧按请求 id 串行挂起
        request.value = event;
    });
}

onUnmounted(() => {
    stopListening?.();
});

const formattedArgs = computed(() => {
    const args = request.value?.args;

    if (args === undefined || args === null) return '';

    if (typeof args === 'string') return args;

    try {
        return JSON.stringify(args, null, 2);
    } catch {
        return String(args);
    }
});

const respond = async (approved: boolean) => {
    const current = request.value;

    request.value = null;

    if (!current) return;

    try {
        await permissionResponse(current.id, approved);
    } catch (error) {
        console.error(error);
    }
};
</script>

<style scoped>
.lume-permission-mask {
    position: fixed;
    right: 24px;
    bottom: 96px;
    z-index: 3000;
}

.lume-permission-card {
    width: 320px;
    padding: 16px;
    background: #fff;
    border: 1px solid #e5e6eb;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgb(31 35 41 / 12%);
}

.lume-permission-title {
    font-size: 15px;
    font-weight: 600;
    color: #1f2329;
}

.lume-permission-tool {
    margin-top: 8px;
    font-size: 13px;
    color: #3446ba;
}

.lume-permission-reason {
    margin-top: 4px;
    font-size: 12px;
    color: #8f959e;
}

.lume-permission-args {
    box-sizing: border-box;
    max-height: 160px;
    margin-top: 8px;
    padding: 8px;
    overflow: auto;
    font-size: 12px;
    background: #f5f6f7;
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-all;
}

.lume-permission-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    margin-top: 12px;
}

.lume-permission-btn {
    padding: 6px 16px;
    font-size: 13px;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
}

.lume-permission-allow {
    color: #fff;
    background: #3446ba;
}

.lume-permission-deny {
    color: #4e5969;
    background: #f2f3f5;
}
</style>
