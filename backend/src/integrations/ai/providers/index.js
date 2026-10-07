'use strict';

const MockAIProvider = require('./mockProvider');

// Provider singleton cache
const providers = {
  mock: new MockAIProvider(),
};

let activeProviderName = 'mock';

function getProvider(name = activeProviderName) {
  if (!providers[name]) {
    // Default fallback to mock
    return providers.mock;
  }
  return providers[name];
}

function registerProvider(name, instance) {
  providers[name] = instance;
}

function setActiveProvider(name) {
  if (!providers[name]) {
    throw new Error(`Cannot set active AI provider to unknown provider: ${name}`);
  }
  activeProviderName = name;
}

function getActiveProvider() {
  return getProvider(activeProviderName);
}

module.exports = {
  getProvider,
  registerProvider,
  setActiveProvider,
  getActiveProvider,
  MockAIProvider,
};
