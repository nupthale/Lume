import OpenAI from 'openai';

const client = new OpenAI({
    baseURL: 'http://10.56.88.230:9998/v1',
    apiKey: 'local',
});

const MODEL = 'qwen3';

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [{
    type: 'function',
    function: {
        name: 'get_weather',
        description: '查询指定城市的当前天气',
        parameters: {
            type: 'object',
            properties: {
                city: { type: 'string', description: '城市名，如"北京"' },
            },
            required: ['city'],
        }
    }
}];

/** 工具的真实实现。这里返回 mock 数据，真实场景换成 HTTP 调用 */
function executeGetWeather({ city }: { city: string }) {
  const mock: Record<string, { temp: number; condition: string }> = {
    北京: { temp: 12, condition: '晴' },
    上海: { temp: 18, condition: '多云' },
  };
  return mock[city] ?? { temp: 20, condition: '晴' };
}

/** 工具名 → 实现的分发表。框架里对应 Mastra 的 createTool + agent 的 tools 参数 */
const toolImplementations: Record<string, (args: any) => unknown> = {
  get_weather: executeGetWeather,
};

const extra_body = { chat_template_kwargs: { enable_thinking: false } };

async function runAgentTurn(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]) {
    while (true) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages,
            tools,
            ...(extra_body ?? {}),
        });

        const assistantMessage = response.choices[0].message;

        messages.push(assistantMessage);

        const toolCalls = assistantMessage.tool_calls ?? [];

        if (toolCalls.length === 0) {
            return assistantMessage.content ?? '(空回复)';
        }

        for (const call of toolCalls) {
            if (call.type !== 'function') continue;

            const args = JSON.parse(call.function.arguments);
            const fn = call.function.name;
            const impl = toolImplementations[fn];
            const result = impl ? impl(args) : { error: 'unknown tool' };

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            })
        }
    }

}

async function main() {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: '你是一个天气助手。用户问天气时必须调用工具查询，不要编造。' },
    ];

    messages.push({ role: 'user', content: '北京今天天气怎么样？' });
    const reply1 = await runAgentTurn(messages);
    console.log(`🤖 ${reply1}\n`);

    messages.push({ role: 'user', content: '那和上海比，哪个更暖和？' });
    const reply2 = await runAgentTurn(messages);
    console.log(`🤖 ${reply2}\n`);
}