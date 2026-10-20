import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIREBASE_SESSION_RESPONSE_ERROR,
  mapFirebaseSessionResponse,
} from '../src/lib/firebaseSession.ts';

const completeSession = {
  access_token: 'session-token',
  token_type: 'bearer',
  user: {
    id: 42,
    name: 'ExamMind student',
    username: 'student_42',
    email: 'student@example.com',
    role: 'student',
  },
};

test('a successful session response maps the token and user together', () => {
  assert.deepEqual(mapFirebaseSessionResponse(completeSession), completeSession);
});

test('a 200-shaped but incomplete session response cannot advance sign-in', () => {
  for (const response of [
    {},
    { access_token: 'session-token' },
    { access_token: 'session-token', token_type: 'bearer', user: null },
    { access_token: '', token_type: 'bearer', user: completeSession.user },
  ]) {
    assert.throws(() => mapFirebaseSessionResponse(response), {
      message: FIREBASE_SESSION_RESPONSE_ERROR,
    });
  }
});
