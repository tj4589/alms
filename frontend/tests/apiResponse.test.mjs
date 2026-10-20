import assert from 'node:assert/strict';
import test from 'node:test';
import { parseJsonBody, sanitizeErrorMessage } from '../src/lib/apiResponse.ts';

test('empty and malformed response bodies are treated as unavailable JSON', () => {
  assert.equal(parseJsonBody(''), null);
  assert.equal(parseJsonBody('   \n'), null);
  assert.equal(parseJsonBody('<html>gateway error</html>'), null);
});

test('valid JSON response bodies remain available to the API client', () => {
  assert.deepEqual(parseJsonBody('{"access_token":"session-token"}'), {
    access_token: 'session-token',
  });
});

test('provider details are replaced with a safe user-facing message', () => {
  assert.equal(
    sanitizeErrorMessage('DeepSeek provider error: insufficient balance'),
    'AI provider balance is currently unavailable. Search and uploaded materials are still working, but live AI answers require a valid API balance.',
  );
  assert.equal(sanitizeErrorMessage('Please verify your email before continuing.'), 'Please verify your email before continuing.');
});
