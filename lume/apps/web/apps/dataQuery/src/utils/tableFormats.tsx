import { EllipsisText, User } from '@zsfe/zsui';
import { isNil } from 'lodash-es';

import Icon from '@/components/Icon/index.vue';
import { formatAmount, formatDate, formatPercent } from '@/utils/util'

export const formats = {
    user: ({ text }) => text ? (<User username={text} />) : '-',
    amount: ({ text, decimalPlaces = 2 }) => {
        const value = formatAmount(text, false, decimalPlaces);
        if (value === '-') return value;

        const intPart = `${value}`.split('.')[0];
        const decimalPart = `${value}`.split('.')[1];

        return <div>
            <span class="">{intPart}</span>
            <span style="color: #bbbfc4;">.{decimalPart}</span>
        </div>;
    },
    branchName: ({ text }) => (
        <div>
            {text?.replace('证券营业部', '') || '-'}
            {text?.includes('证券营业部') ? (<span style="color: #bbbfc4;">营业部</span>) : ''}
        </div>
    ),
    dateRange: ({ record }) => (
        <span>
            <span style="display: inline-block; width: 82px;">{formatDate(`${record.startDate}`, 'yyyy-MM-dd')}</span> 
            <span class="lightText mx-2">-</span>
            {
                record?.endDate >= 20991231 ? (
                    <span style="color: #ccc;">{formatDate(`${record.endDate}`, 'yyyy-MM-dd')}</span>
                ) : formatDate(`${record.endDate}`, 'yyyy-MM-dd')
            }
        </span>
    ),
    numberDate: ({ text }) => formatDate(`${text}`, 'yyyy-MM-dd'),
    date: ({ text }) => formatDate(text, 'yyyy-MM-DD HH:mm'),
    company: ({ text }) => (<div class="flex items-center" key={text}><Icon style="color:#8f959e;" icon="building_outlined" size="14px" class="mr-1.5 flex-shrink-0"></Icon><EllipsisText title={text}><span>{text}</span></EllipsisText></div>), 
    percent: ({ text }) => !isNil(text) ? (<div>{formatPercent(text)}<span class="ml-1 lightText">%</span></div>) : '-',
    text: ({ text }) => (text?.length ? <EllipsisText key={text} title={text}><span>{text}</span></EllipsisText> : '-'),
    emptyCol: () => '',
};