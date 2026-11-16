import { ref } from 'vue';

export const useConversationActions = () => {
    const hoverId = ref();
    const hoverTimerId = ref();

    const actionDropdownVisible = ref(false);
    const actionDropdownTimerId = ref();

    const handleConversationMouseEnter = (id) => {
        clearTimeout(hoverTimerId.value);
    
        hoverId.value = id;
    }
    
    const handleConversationMouseLeave = () => {
        hoverTimerId.value = setTimeout(() => {
            hoverId.value = '';
            actionDropdownVisible.value = false;
        }, 100);
    }

    const handleConversationActionMouseClick = () => {
        clearTimeout(hoverTimerId.value);
        clearTimeout(actionDropdownTimerId.value);

        actionDropdownVisible.value = true;
    }

    const handleConversationMenuMouseEnter = () => {
        clearTimeout(hoverTimerId.value);
        clearTimeout(actionDropdownTimerId.value);
    }

    const handleConversationMenuMouseLeave = () => {
        actionDropdownVisible.value = false;
        hoverId.value = '';
    }

    return {
        hoverId,
        actionDropdownVisible,
        actionDropdownTimerId,
        handleConversationMouseEnter,
        handleConversationMouseLeave,
        handleConversationMenuMouseEnter,
        handleConversationMenuMouseLeave,

        handleConversationActionMouseClick,
    };
}