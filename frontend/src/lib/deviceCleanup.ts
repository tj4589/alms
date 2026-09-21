/**
 * Run device cleanup after the server has already updated account state.
 * Keeping this callback-only makes retries incapable of sending another
 * server lifecycle request.
 */
export async function attemptDeviceCleanup(cleanup: () => Promise<void>): Promise<boolean> {
  try {
    await cleanup();
    return true;
  } catch {
    return false;
  }
}
