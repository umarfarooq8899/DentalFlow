'use strict';

/**
 * Base AI Provider Abstract Interface
 *
 * Defines the standard contract that all LLM provider adapters must implement.
 * Decouples the application from any specific vendor (OpenAI, Anthropic, Gemini, etc.).
 */
class BaseAIProvider {
  constructor(name = 'base', region = 'us-east-1') {
    this.name = name;
    this.region = region;
  }

  /**
   * Generates a completion from the provider.
   *
   * @param {object} params
   * @param {string} params.prompt - The redacted prompt text.
   * @param {string} [params.systemPrompt] - System instructions.
   * @param {string} [params.jobType] - Job type ('lead_scoring' | 'suggested_reply').
   * @param {string} [params.model] - Target model identifier.
   * @param {number} [params.timeoutMs] - Timeout in milliseconds.
   * @returns {Promise<{ content: string, model: string, provider: string, providerRegion: string, raw: any }>}
   */
  async generateCompletion(params) {
    throw new Error('generateCompletion() must be implemented by provider subclass');
  }

  /**
   * Returns whether the provider is healthy / reachable.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    return true;
  }
}

module.exports = BaseAIProvider;
