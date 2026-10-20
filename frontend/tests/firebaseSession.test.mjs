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
    account_status: 'active',
    admin_portal_access: false,
  },
};

test('a successful session response maps the token and user together', () => {
  assert.deepEqual(mapFirebaseSessionResponse(completeSession), completeSession);
});

test('documented optional user fields receive the API defaults', () => {
  assert.deepEqual(
    mapFirebaseSessionResponse({
      access_token: 'session-token',
      token_type: 'bearer',
      user: { id: 42, name: 'ExamMind student', email: 'student@example.com' },
    }).user,
    {
      id: 42,
      name: 'ExamMind student',
      username: null,
      email: 'student@example.com',
      role: 'student',
      account_status: 'active',
      admin_portal_access: false,
    },
  );
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
