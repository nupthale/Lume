import { VNode } from 'vue';

export interface QueryFormSchema {
  width: number;
  field: string;
  label: string | VNode;
  component: string;
  defaultValue?: any;
  valueField?: string;
  componentProps: Record<string, any>;
  required?: boolean | ((renderCallbackParams: RenderCallbackParams) => boolean);
}
