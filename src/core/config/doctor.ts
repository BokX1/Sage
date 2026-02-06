/* eslint-disable no-console */
import { config } from './legacy-config-adapter';
import { getLLMClient } from '../llm';
import { withTimeout } from '../../shared/async/resilience';

export async function runConfigDoctor() {
  console.log('🩺 Running Configuration Doctor...');

  // Warning check for double path
  if (config.llmBaseUrl && config.llmBaseUrl.includes('/chat/completions')) {
    console.warn(
      '⚠️  LLM_BASE_URL contains "/chat/completions". This is usually a mistake. Auto-normalizing behavior enabled in provider.',
    );
  }

  const checks = [
    { name: 'Discord Token', valid: !!config.discordToken, sensitive: true },
    {
      name: 'Discord App ID',
      valid: !!config.discordAppId,
      value: config.discordAppId ? '[PRESENT]' : '[MISSING]',
    },
    { name: 'LLM Provider', valid: true, value: config.llmProvider || 'pollinations (default)' },
    {
      name: 'LLM Base URL',
      valid: true,
      value: config.llmBaseUrl || 'https://gen.pollinations.ai/v1 (default)',
    },
    {
      name: 'Chat Model',
      // Allow gemini, deepseek, or other valid models
      valid: ['gemini', 'deepseek', 'openai', 'mistral', 'llama', 'gpt-4o', 'qwen-coder'].some((m) =>
        (config.chatModel || 'gemini').includes(m),
      ),
      value: config.chatModel || 'gemini (default)',
    },
    {
      name: 'LLM API Key',
      valid: true,
      sensitive: true,
      present: !!config.llmApiKey,
    },
    {
      name: 'Profile Provider',
      valid: true,
      value: config.profileProvider || 'default (using LLM_PROVIDER)',
    },
    {
      name: 'Profile Model',
      valid: true,
      value: config.profileChatModel || 'default (using provider model)',
    },
  ];

  const results = checks.map((c) => {
    const status = c.valid ? '✅' : '❌';
    let value: string;
    if (c.sensitive) {
      // Never print actual key value
      if ('present' in c) {
        value = c.present ? '[PRESENT]' : '[NOT SET - CONFIGURE A GLOBAL OR SERVER KEY]';
      } else {
        value = c.valid ? '[PRESENT]' : '[MISSING]';
      }
    } else {
      value = c.value || (c.valid ? 'OK' : 'MISSING');
    }
    return `${status} ${c.name}: ${value}`;
  });

  console.log(results.join('\n'));

  if (checks.some((c) => !c.valid)) {
    console.error('❌ Configuration validation failed. Check .env file.');
    return; // Don't ping if config is broken
  } else {
    console.log('✅ Configuration validated.');
  }

  // Optional LLM Ping
  if (config.llmDoctorPing === '1') {
    console.log('\n📡 Pinging LLM Provider...');
    try {
      const client = getLLMClient();
      // Tiny timeout for ping
      const response = await withTimeout(
        client.chat({
          messages: [{ role: 'user', content: 'say OK' }],
          maxTokens: 5,
          temperature: 0.1,
        }),
        5000,
        'Doctor LLM ping',
      );
      console.log('✅ LLM Ping: SUCCESS');
      console.log(`   Response: "${response.content.trim()}"`);
    } catch (error) {
      console.error('❌ LLM Ping: FAILED');
      console.error(`   Error: ${(error as Error).message}`);
    }
  }
}
