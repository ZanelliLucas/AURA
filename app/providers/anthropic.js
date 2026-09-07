const Anthropic = require('@anthropic-ai/sdk');

async function complete({ apiKey, model, systemPrompt, messages }) {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content }))
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  return { text };
}

module.exports = { complete };
