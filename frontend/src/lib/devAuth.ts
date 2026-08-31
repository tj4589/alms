import type { User } from '../types';

export const DEV_AUTH_ENABLED = import.meta.env.DEV;
export const DEV_AUTH_TOKEN = 'exammind:local-development-session';

export const DEV_AUTH_USER: User = {
  id: -1,
  name: 'Dev Student',
  username: 'dev_student',
  email: 'dev@localhost',
  role: 'student',
};

export function isDevAuthToken(token: string | null): boolean {
  return DEV_AUTH_ENABLED && token === DEV_AUTH_TOKEN;
}

export function validateDevAuthPass(value: string): boolean {
  if (!DEV_AUTH_ENABLED) return false;
  const configuredPass = import.meta.env.VITE_DEV_AUTH_PASS?.trim();
  return value === (configuredPass || 'exammind-dev');
}
