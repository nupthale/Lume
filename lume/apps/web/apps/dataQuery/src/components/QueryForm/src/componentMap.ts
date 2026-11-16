import type { Component } from 'vue';

/**
 * Component list, register here to setting it in the form
 */
import {
  Input,
  Select,
  Radio,
  Checkbox,
  AutoComplete,
  Cascader,
  DatePicker,
  InputNumber,
  Switch,
  TimePicker,
  TreeSelect,
  Slider,
  Rate,
  Divider,
  Mentions,
} from 'ant-design-vue';

import DictSelect from '@/components/Form/DictSelect.vue';
import UserSelect from '@/components/Form/UserSelect.vue';
import DepartmentSelect from '@/components/Form/DepartmentSelect.vue';
import BranchSelect from '@/components/Form/BranchSelect.vue';
import EmployeeSelect from '@/components/Form/EmployeeSelect.vue';
import ProductSelect from '@/components/Form/ProductSelect.vue';

const componentMap = new Map<string, Component>();

componentMap.set('Input', Input);
componentMap.set('InputGroup', Input.Group);
componentMap.set('InputPassword', Input.Password);
componentMap.set('InputSearch', Input.Search);
componentMap.set('InputTextArea', Input.TextArea);
componentMap.set('InputNumber', InputNumber);
componentMap.set('AutoComplete', AutoComplete);
componentMap.set('Mentions', Mentions);

componentMap.set('Select', Select);
componentMap.set('TreeSelect', TreeSelect);
componentMap.set('Switch', Switch);
componentMap.set('RadioGroup', Radio.Group);
componentMap.set('Checkbox', Checkbox);
componentMap.set('CheckboxGroup', Checkbox.Group);
componentMap.set('Cascader', Cascader);
componentMap.set('Slider', Slider);
componentMap.set('Rate', Rate);

componentMap.set('DatePicker', DatePicker);
componentMap.set('MonthPicker', DatePicker.MonthPicker);
componentMap.set('RangePicker', DatePicker.RangePicker);
componentMap.set('WeekPicker', DatePicker.WeekPicker);
componentMap.set('TimePicker', TimePicker);

componentMap.set('Divider', Divider);

// custom
componentMap.set('DictSelect', DictSelect);
componentMap.set('UserSelect', UserSelect);
componentMap.set('DepartmentSelect', DepartmentSelect);
componentMap.set('BranchSelect', BranchSelect);
componentMap.set('EmployeeSelect', EmployeeSelect);
componentMap.set('ProductSelect', ProductSelect);

export { componentMap };
