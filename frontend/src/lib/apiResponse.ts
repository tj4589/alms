export function parseJsonBody(body: string): unknown | null {
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export function sanitizeErrorMessage(message: string): string {
  const text = String(message || '');
  const lowered = text.toLowerCase();
  if (lowered.includes('402') || lowered.includes('insufficient balance')) {
    return 'AI provider balance is currently unavailable. Search and uploaded materials are still working, but live AI answers require a valid API balance.';
  }
  if (
    lowered.includes('deepseek') ||
    lowered.includes('cohere') ||
    lowered.includes('provider error')
  ) {
    return 'The primary AI provider is temporarily unavailable. ExamMind tried the fallback provider.';
  }
  return text;
}
