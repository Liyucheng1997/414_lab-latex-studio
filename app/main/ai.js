// Claude API access for the writing assistant. Runs in the main process so the API key never reaches the page.
const { safeStorage, net } = require('electron');
const Anthropic = require('@anthropic-ai/sdk').default;
const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');

const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
const running = new Map(); // request id -> AbortController

async function decryptKey(settings) {
  if (!settings.aiKeyEnc) return null;
  try { return (await safeStorage.decryptStringAsync(Buffer.from(settings.aiKeyEnc, 'base64'))).result; } catch { return null; }
}

async function encryptKey(key) {
  if (!key) return '';
  if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统不支持安全存储，无法保存 API Key');
  return (await safeStorage.encryptStringAsync(key)).toString('base64');
}

async function makeClient(settings) {
  const apiKey = await decryptKey(settings);
  // Without a stored key the SDK falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login`.
  // Electron's net.fetch honours the system proxy settings.
  return new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(settings.aiBaseURL ? { baseURL: settings.aiBaseURL } : {}),
    fetch: (url, init) => net.fetch(url, init),
    maxRetries: 2,
  });
}

function status(settings) {
  const source = settings.aiKeyEnc ? 'key' : process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? 'env' : 'none';
  return { source, model: settings.aiModel, baseURL: settings.aiBaseURL || '' };
}

// Server-side refusal fallback: available for the Opus/Sonnet/Fable tiers, not for Haiku.
const fallbackParams = (model) => (/haiku/.test(model) ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API Key 无效或未配置，请在 设置 → AI 中填写。';
  if (e instanceof Anthropic.PermissionDeniedError) return '当前 API Key 没有访问该模型的权限。';
  if (e instanceof Anthropic.NotFoundError) return '模型不存在或 API 地址不正确。';
  if (e instanceof Anthropic.RateLimitError) return '请求过于频繁或额度不足，请稍后再试。';
  if (e instanceof Anthropic.BadRequestError) return '请求被拒绝：' + (e.message || '');
  if (e instanceof Anthropic.APIConnectionError) return '无法连接到 Claude API，请检查网络或代理设置。';
  if (e instanceof Anthropic.APIError) return `API 错误 ${e.status ?? ''}：${e.message}`;
  if (/authentication|apiKey|api key/i.test(String(e?.message))) return '没有找到 API Key，请在 设置 → AI 中填写。';
  return String(e?.message || e);
}

/** Stream a reply; events go to `send(type, payload)`. Resolves with the final assistant content. */
async function stream(settings, { id, system, messages, model, effort }, send) {
  const controller = new AbortController();
  running.set(id, controller);
  const m = MODELS.includes(model) ? model : settings.aiModel || 'claude-opus-5-5';
  try {
    const client = await makeClient(settings);
    const s = client.beta.messages.stream({
      model: m,
      max_tokens: 64000,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: effort || settings.aiEffort || 'medium' },
      cache_control: { type: 'ephemeral' },
      system,
      messages,
      ...fallbackParams(m),
    }, { signal: controller.signal });
    for await (const ev of s) {
      if (ev.type === 'content_block_start' && ev.content_block.type === 'thinking') send('thinking-start', {});
      else if (ev.type === 'content_block_delta') {
        if (ev.delta.type === 'text_delta') send('text', { text: ev.delta.text });
        else if (ev.delta.type === 'thinking_delta') send('thinking', { text: ev.delta.thinking });
      }
    }
    const final = await s.finalMessage();
    const result = { content: final.content, stop_reason: final.stop_reason, usage: final.usage, model: final.model, stop_details: final.stop_details ?? null };
    send('done', result);
    return result;
  } catch (e) {
    if (controller.signal.aborted) { send('aborted', {}); return null; }
    send('error', { message: describeError(e) });
    return null;
  } finally {
    running.delete(id);
  }
}

function abort(id) {
  const c = running.get(id);
  if (c) c.abort();
}

// Structured edits for "fix this compile error": exact find/replace pairs on the source file.
const FixSchema = z.object({
  explanation: z.string().describe('用中文简要说明错误原因和修改内容'),
  edits: z.array(z.object({
    find: z.string().describe('需要替换的原文，必须与文件内容逐字一致，包含足够上下文以唯一定位'),
    replace: z.string().describe('替换后的文本'),
  })),
});

async function fix(settings, { system, prompt, model }) {
  const m = MODELS.includes(model) ? model : settings.aiModel || 'claude-opus-5-5';
  try {
    const client = await makeClient(settings);
    const res = await client.messages.parse({
      model: m,
      max_tokens: 16000,
      output_config: { effort: settings.aiEffort || 'medium', format: zodOutputFormat(FixSchema) },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    if (res.stop_reason === 'refusal') return { error: '模型拒绝了这个请求。' };
    if (!res.parsed_output) return { error: '模型没有返回可用的修改。' };
    return res.parsed_output;
  } catch (e) {
    return { error: describeError(e) };
  }
}

module.exports = { stream, abort, fix, status, encryptKey, MODELS };
