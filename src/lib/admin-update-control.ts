import { redis } from './redis-client';

export interface UpdateSettings {
  autoUpdateEnabled: boolean;
  updatesPerHour: number; // 1-60
  lastUpdated: number; // timestamp
  nextScheduledUpdate: number; // timestamp
}

export interface UpdateJob {
  id: string;
  type: 'weather' | 'sports' | 'odds' | 'nws' | 'all';
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  error?: string;
}

const SETTINGS_KEY = 'admin:update-settings';
const JOBS_KEY_PREFIX = 'admin:update-job:';

/**
 * Get current update settings
 */
export async function getUpdateSettings(): Promise<UpdateSettings> {
  const stored = await redis.get(SETTINGS_KEY);

  if (!stored) {
    const defaults: UpdateSettings = {
      autoUpdateEnabled: false, // Default OFF
      updatesPerHour: 4,
      lastUpdated: 0,
      nextScheduledUpdate: 0,
    };
    await saveUpdateSettings(defaults);
    return defaults;
  }

  return typeof stored === 'string' ? JSON.parse(stored) : stored;
}

/**
 * Save update settings
 */
export async function saveUpdateSettings(settings: UpdateSettings): Promise<void> {
  await redis.set(SETTINGS_KEY, JSON.stringify(settings), { ex: 86400 * 30 });
}

/**
 * Update auto-update enabled status
 */
export async function setAutoUpdateEnabled(enabled: boolean): Promise<void> {
  const settings = await getUpdateSettings();
  settings.autoUpdateEnabled = enabled;
  await saveUpdateSettings(settings);
}

/**
 * Set updates per hour frequency (1-60)
 */
export async function setUpdatesPerHour(frequency: number): Promise<void> {
  if (frequency < 1 || frequency > 60) {
    throw new Error('Updates per hour must be between 1 and 60');
  }

  const settings = await getUpdateSettings();
  settings.updatesPerHour = frequency;

  // Calculate next update time
  const intervalMs = (3600 * 1000) / frequency;
  settings.nextScheduledUpdate = Date.now() + intervalMs;

  await saveUpdateSettings(settings);
}

/**
 * Manually trigger an update job
 */
export async function triggerManualUpdate(
  type: 'weather' | 'sports' | 'odds' | 'nws' | 'all'
): Promise<string> {
  const jobId = `${type}-${Date.now()}`;
  const job: UpdateJob = {
    id: jobId,
    type,
    status: 'pending',
    startedAt: Date.now(),
  };

  await redis.set(
    `${JOBS_KEY_PREFIX}${jobId}`,
    JSON.stringify(job),
    { ex: 3600 } // Keep for 1 hour
  );

  return jobId;
}

/**
 * Get update job status
 */
export async function getUpdateJobStatus(jobId: string): Promise<UpdateJob | null> {
  const stored = await redis.get(`${JOBS_KEY_PREFIX}${jobId}`);

  if (!stored) return null;

  return typeof stored === 'string' ? JSON.parse(stored) : stored;
}

/**
 * Update job status
 */
export async function updateJobStatus(
  jobId: string,
  status: 'running' | 'completed' | 'failed',
  error?: string
): Promise<void> {
  const job = await getUpdateJobStatus(jobId);

  if (!job) return;

  job.status = status;
  if (status === 'completed' || status === 'failed') {
    job.completedAt = Date.now();
  }
  if (error) {
    job.error = error;
  }

  await redis.set(
    `${JOBS_KEY_PREFIX}${jobId}`,
    JSON.stringify(job),
    { ex: 3600 }
  );

  // Update last update time if successful
  if (status === 'completed') {
    const settings = await getUpdateSettings();
    settings.lastUpdated = Date.now();

    // Calculate next scheduled update
    const intervalMs = (3600 * 1000) / settings.updatesPerHour;
    settings.nextScheduledUpdate = Date.now() + intervalMs;

    await saveUpdateSettings(settings);
  }
}

/**
 * Get recent update jobs (last N)
 */
export async function getRecentUpdateJobs(limit: number = 20): Promise<UpdateJob[]> {
  // This is a simplified version — in production you'd want to
  // maintain a sorted list or use a proper job queue
  const jobs: UpdateJob[] = [];
  // Implementation would scan Redis keys and collect jobs
  return jobs;
}

/**
 * Check if an auto-update is due
 */
export async function isAutoUpdateDue(): Promise<boolean> {
  const settings = await getUpdateSettings();

  if (!settings.autoUpdateEnabled) {
    return false;
  }

  return Date.now() >= settings.nextScheduledUpdate;
}
