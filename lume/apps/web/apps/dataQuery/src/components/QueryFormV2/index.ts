import { InlineQuery, GridQuery, queryComponent } from '@zsfe/zsui';

import DictSelect from '@/components/Form/DictSelect.vue';
import UserSelect from '@/components/Form/UserSelect.vue';
import DepartmentSelect from '@/components/Form/DepartmentSelect.vue';
import BranchSelect from '@/components/Form/BranchSelect.vue';
import EmployeeSelect from '@/components/Form/EmployeeSelect.vue';
import ProductSelect from '@/components/Form/ProductSelect.vue';

import './index.less';

queryComponent.regsiter('DictSelect', {
    component: DictSelect,
    parseValue: (value) => value,
    valueText: () => {
        return '';
    },
});

queryComponent.regsiter('DepartmentSelect', {
    component: DepartmentSelect,
    parseValue: (value) => value,
    valueText: () => {
        return '';
    },
});

queryComponent.regsiter('UserSelect', {
    component: UserSelect,
    parseValue: (value) => value,
    valueText: () => {
        return '';
    },
});

queryComponent.regsiter('BranchSelect', {
    component: BranchSelect,
    parseValue: (value) => value,
    valueText: () => {
        return '';
    },
});

queryComponent.regsiter('EmployeeSelect', {
    component: EmployeeSelect,
    parseValue: (value) => value,
    valueText: () => {
        return '';
    },
});

queryComponent.regsiter('ProductSelect', {  
    component: ProductSelect,
    parseValue: (value) => value,
    valueText: () => {
        return '';
    },
});

export {
    InlineQuery,
    GridQuery,
};