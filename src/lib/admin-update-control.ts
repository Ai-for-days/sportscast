// Stub file for admin update control
export async function setUpdatesPerHour(rate: number): Promise<void> {
  // Not implemented
}

export async function getUpdateSettings(): Promise<any> {
  return {};
}

export async function getUpdateJobStatus(): Promise<any> {
  return { status: 'idle' };
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  // Not implemented
}

export async function triggerManualUpdate(): Promise<void> {
  // Not implemented
}
