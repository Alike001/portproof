// PortProof — Target-Native Behavior Proof
// contractId: create-request-options-zero-timeout
// public boundary: src/request.js#createRequestOptions
//
// Setup: REQUEST_TIMEOUT_MS = "0"
// Operation: createRequestOptions({ REQUEST_TIMEOUT_MS: "0" })
// Expected: timeout === 0

import { createRequestOptions } from './src/request.js';

const env = { REQUEST_TIMEOUT_MS: '0' };
const result = createRequestOptions(env);
const observed = result.timeout;

console.log(`PORTPROOF_OBSERVED timeout=${observed}`);

import assert from 'node:assert/strict';
assert.strictEqual(observed, 0, `Expected timeout to be 0, got ${observed}`);
