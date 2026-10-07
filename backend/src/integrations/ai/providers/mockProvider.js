'use strict';

const BaseAIProvider = require('./baseProvider');
const AppError = require('../../../errors/AppError');

/**
 * Mock AI Provider for deterministic testing and local development.
 *
 * Records all prompts received to verify PII redaction integrity.
 * Simulates provider failures, timeouts, and malformed outputs.
 */
class MockAIProvider extends BaseAIProvider {
  constructor() {
    super('mock', 'us-east-1');
    this.receivedCalls = [];
    this.simulateFailure = false;
    this.failureError = null;
    this.simulateTimeout = false;
    this.simulateMalformed = false;
    this.customResponse = null;
  }

  reset() {
    this.receivedCalls = [];
    this.simulateFailure = false;
    this.failureError = null;
    this.simulateTimeout = false;
    this.simulateMalformed = false;
    this.customResponse = null;
  }

  setSimulateFailure(enable = true, message = 'Provider connection failed', code = 'AI_PROVIDER_ERROR') {
    this.simulateFailure = enable;
    this.failureError = { message, code };
  }

  setSimulateTimeout(enable = true) {
    this.simulateTimeout = enable;
  }

  setSimulateMalformed(enable = true) {
    this.simulateMalformed = enable;
  }

  setCustomResponse(response) {
    this.customResponse = response;
  }

  getLastReceivedPrompt() {
    return this.receivedCalls.length > 0
      ? this.receivedCalls[this.receivedCalls.length - 1].prompt
      : null;
  }

  getAllReceivedPrompts() {
    return this.receivedCalls.map((c) => c.prompt);
  }

  async generateCompletion(params) {
    const { prompt, systemPrompt, jobType, model = 'mock-llm-v1', timeoutMs = 5000 } = params;

    // Record the call
    this.receivedCalls.push({
      prompt,
      systemPrompt,
      jobType,
      model,
      timestamp: new Date(),
    });

    // Simulate timeout
    if (this.simulateTimeout) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs + 50, 100)));
      throw AppError.badRequest('AI Provider request timed out.', 'AI_TIMEOUT');
    }

    // Simulate provider outage / network failure
    if (this.simulateFailure) {
      const err = new Error(this.failureError ? this.failureError.message : 'External AI service unavailable');
      err.code = this.failureError ? this.failureError.code : 'AI_PROVIDER_UNAVAILABLE';
      err.status = 502;
      throw err;
    }

    // Simulate malformed JSON
    if (this.simulateMalformed) {
      return {
        content: '<<<INVALID_JSON>>>{ "broken: true, ',
        model,
        provider: this.name,
        providerRegion: this.region,
        raw: { simulated: true },
      };
    }

    // Custom response if set
    if (this.customResponse !== null) {
      const content =
        typeof this.customResponse === 'string'
          ? this.customResponse
          : JSON.stringify(this.customResponse);
      return {
        content,
        model,
        provider: this.name,
        providerRegion: this.region,
        raw: { simulated: true },
      };
    }

    // Default responses based on job type
    let contentObj;
    if (jobType === 'lead_scoring') {
      contentObj = {
        score: 85,
        intent: 'high',
        urgency: 'urgent',
        recommendedActions: [
          'Schedule immediate consultation',
          'Send appointment confirmation to lead',
        ],
        rationale: 'High urgency expressed regarding acute dental discomfort.',
      };
    } else if (jobType === 'suggested_reply') {
      contentObj = {
        suggestedReply:
          'Hello, thank you for reaching out to DentalFlow clinic. We would be delighted to schedule your appointment. Please let us know if mornings or afternoons work best for you.',
        intent: 'appointment_inquiry',
        confidence: 0.95,
        keyPoints: [
          'Warm greeting',
          'Prompt response to appointment inquiry',
          'Availability preference request',
        ],
      };
    } else {
      contentObj = { result: 'Processed successfully' };
    }

    return {
      content: JSON.stringify(contentObj),
      model,
      provider: this.name,
      providerRegion: this.region,
      raw: { simulated: true },
    };
  }
}

module.exports = MockAIProvider;
