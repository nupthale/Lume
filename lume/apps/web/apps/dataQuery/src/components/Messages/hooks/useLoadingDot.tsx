export const useLoadingDot = () => {
    // 递归查找整个AST中的最后一个文本节点
    const findLastTextNode = (node): any => {
        if (node.type === 'text') {
            return node;
        }

        if (node.children && node.children.length > 0) {
            // 从后往前查找
            for (let i = node.children.length - 1; i >= 0; i--) {
                const result = findLastTextNode(node.children[i]);
                if (result) return result;
            }
        }
        return null;
    };

    // 标记目标文本节点
    const markLastTextNode = (node, targetTextNode) => {
        if (node === targetTextNode) {
            node._addLoading = true;
            return true;
        }
        if (node.children) {
            for (const child of node.children) {
                if (markLastTextNode(child, targetTextNode)) {
                    return true;
                }
            }
        }
        return false;
    };

    const addLoadingDot = (ast) => {
        const lastTextNode = findLastTextNode(ast);
        if (lastTextNode) {
            markLastTextNode(ast, lastTextNode);
        }
    }

    return {
        addLoadingDot,
    };
}