import { computed } from 'vue';

export const useCheckAll = (valueRef, list, checkedIds, onUpdateValue) => {
    const checkAll = computed(() => {
        return list.value?.every(item => {
            return checkedIds.value?.includes(item?.fieldCode);
        })
    });

    const checkNone = computed(() => {
        return !list.value.some(item => {
            return checkedIds.value?.includes(item?.fieldCode);
        });
    });

    const checkAllIndeterminate = computed(() => {
        return !checkAll.value && !checkNone.value;
    });

    const handleCheckAll = () => {
        let newValue = [
            ...(valueRef.value),
        ];

        // 如果一个都没勾选， 则全部加入
        // 如果选了部分， 则把剩下的加入
        // 如果全选了， 则全部取消选中
        if (checkNone.value) {
            newValue = [
                ...(newValue),
                ...(list.value),
            ];
        } else if (checkAllIndeterminate.value) {
            list.value.forEach(product => {
                const checked = checkedIds.value?.includes(product?.fieldCode);
    
                if (!checked) {
                    newValue.push(product);
                }                
            });
        } else if (checkAll.value) {
            newValue = newValue.filter(item => {
                const productIds = list.value.map(product => product?.fieldCode);

                return !productIds.includes(item.fieldCode);
            });
        }

        onUpdateValue(newValue);
    }

    return {
        checkAll,
        checkAllIndeterminate,
        handleCheckAll,
    };
}