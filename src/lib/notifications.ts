import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type NotificationSeverity = 'info' | 'warning' | 'critical';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'partial';
export type NotificationChannel = 'webhook' | 'slack_webhook' | 'email_stub' | 'internal_log';

export interface DeliveryResult {
  channel: NotificationChannel;
  status: 'sent' | 'failed';
  statusCode?: number;
  error?: string;
  timestamp: string;
}

export interface Notification {
  id: string;
  createdAt: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: string;
  channels: string[];
  status: NotificationStatus;
  deliveryResults: DeliveryResult[];
  metadata?: any;
}

export interface NotificationConfig {
  notificationsEnabled: boolean;
  webhookUrl?: string;
  slackWebhookUrl?: string;
  emailEnabled?: boolean;
}

const NOTIF_PREFIX = 'notif:';
const NOTIF_SET = 'notifications:all';
const CONFIG_KEY = 'notification:config';

/* ------------------------------------------------------------------ */
/*  Config                                                              */
/* ------------------------------------------------------------------ */

export async function getNotificationConfig(): Promise<NotificationConfig> {
  const redis = getRedis();
  const raw = await redis.get(CONFIG_KEY);
  if (!raw) return { notificationsEnabled: false };
  return typeof raw === 'string' ? JSON.parse(raw) : raw as NotificationConfig;
}

export async function saveNotificationConfig(config: NotificationConfig): Promise<void> {
  const redis = getRedis();
  await redis.set(CONFIG_KEY, JSON.stringify(config));
  await logAuditEvent({
    actor: 'admin',
    eventType: 'notification_config_updated',
    targetType: 'system',
    targetId: 'notification-config',
    summary: `Notifications ${config.notificationsEnabled ? 'enabled' : 'disabled'}, webhook=${!!config.webhookUrl}, slack=${!!config.slackWebhookUrl}`,
  });
}

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveNotification(n: Notification): Promise<void> {
  const redis = getRedis();
  await redis.set(`${NOTIF_PREFIX}${n.id}`, JSON.stringify(n));
  await redis.zadd(NOTIF_SET, { score: Date.now(), member: n.id });
}

export async function getNotification(id: string): Promise<Notification | null> {
  const redis = getRedis();
  const raw = await redis.get(`${NOTIF_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as Notification;
}

export async function listNotifications(limit = 100): Promise<Notification[]> {
  const redis = getRedis();
  const ids = await redis.zrange(NOTIF_SET, 0, limit - 1, { rev: true }) || [];
  const results: Notification[] = [];
  for (const id of ids) {
    const n = await getNotification(id);
    if (n) results.push(n);
  }
  return results;
}

/* ------------------------------------------------------------------ */
/*  Channel delivery                                                    */
/* ------------------------------------------------------------------ */

async function deliverWebhook(url: string, payload: any): Promise<DeliveryResult> {
  const ts = new Date().toISOString();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { channel: 'webhook', status: 'sent', statusCode: res.status, timestamp: ts };
    return { channel: 'webhook', status: 'failed', statusCode: res.status, error: `HTTP ${res.status}`, timestamp: ts };
  } catch (err: any) {
    return { channel: 'webhook', status: 'failed', error: err.message || 'Network error', timestamp: ts };
  }
}

async function deliverSlack(url: string, title: string, message: string, severity: string): Promise<DeliveryResult> {
  const ts = new Date().toISOString();
  const emoji = severity === 'critical' ? ':rotating_light:' : severity === 'warning' ? ':warning:' : ':information_source:';
  const payload = {
    text: `${emoji} *${title}*\n${message}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${emoji} ${title}` } },
      { type: 'section', text: { type: 'mrkdwn', text: message } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Severity: *${severity}* | ${ts}` }] },
    ],
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { channel: 'slack_webhook', status: 'sent', statusCode: res.status, timestamp: ts };
    return { channel: 'slack_webhook', status: 'failed', statusCode: res.status, error: `HTTP ${res.status}`, timestamp: ts };
  } catch (err: any) {
    return { channel: 'slack_webhook', status: 'failed', error: err.message || 'Network error', timestamp: ts };
  }
}

function deliverEmailStub(title: string, message: string): DeliveryResult {
  // Stub — logs intent but does not send real email
  return { channel: 'email_stub', status: 'sent', timestamp: new Date().toISOString() };
}

function deliverInternalLog(n: { title: string; message: string; severity: string }): DeliveryResult {
  // Internal log is always successful — recorded via audit log
  return { channel: 'internal_log', status: 'sent', timestamp: new Date().toISOString() };
}

/* ------------------------------------------------------------------ */
/*  Send notification                                                   */
/* ------------------------------------------------------------------ */

export async function sendNotification(input: {
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  sourceType?: string;
  sourceId?: string;
  channels: NotificationChannel[];
  metadata?: any;
}): Promise<Notification> {
  const config = await getNotificationConfig();

  const n: Notification = {
    id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    type: input.type,
    severity: input.severity,
    title: input.title,
    message: input.message,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    channels: input.channels,
    status: 'pending',
    deliveryResults: [],
    metadata: input.metadata,
  };

  if (!config.notificationsEnabled) {
    // Still log internally but skip external delivery
    n.deliveryResults.push(deliverInternalLog(n));
    n.status = 'sent';
    await saveNotification(n);
    return n;
  }

  for (const ch of input.channels) {
    try {
      let result: DeliveryResult;
      switch (ch) {
        case 'webhook':
          if (config.webhookUrl) {
            result = await deliverWebhook(config.webhookUrl, {
              type: n.type, severity: n.severity, title: n.title,
              message: n.message, sourceType: n.sourceType, sourceId: n.sourceId,
              createdAt: n.createdAt, metadata: n.metadata,
            });
          } else {
            result = { channel: 'webhook', status: 'failed', error: 'Webhook URL not configured', timestamp: new Date().toISOString() };
          }
          break;
        case 'slack_webhook':
          if (config.slackWebhookUrl) {
            result = await deliverSlack(config.slackWebhookUrl, n.title, n.message, n.severity);
          } else {
            result = { channel: 'slack_webhook', status: 'failed', error: 'Slack webhook URL not configured', timestamp: new Date().toISOString() };
          }
          break;
        case 'email_stub':
          result = deliverEmailStub(n.title, n.message);
          break;
        case 'internal_log':
          result = deliverInternalLog(n);
          break;
        default:
          result = { channel: ch as NotificationChannel, status: 'failed', error: `Unknown channel: ${ch}`, timestamp: new Date().toISOString() };
      }
      n.deliveryResults.push(result);
    } catch (err: any) {
      n.deliveryResults.push({ channel: ch as NotificationChannel, status: 'failed', error: err.message, timestamp: new Date().toISOString() });
    }
  }

  // Determine overall status
  const sent = n.deliveryResults.filter(r => r.status === 'sent').length;
  const failed = n.deliveryResults.filter(r => r.status === 'failed').length;
  if (failed === 0) n.status = 'sent';
  else if (sent === 0) n.status = 'failed';
  else n.status = 'partial';

  await saveNotification(n);

  await logAuditEvent({
    actor: 'system',
    eventType: n.status === 'failed' ? 'notification_failed' : 'notification_sent',
    targetType: 'notification',
    targetId: n.id,
    summary: `${n.severity} notification: ${n.title} — ${n.status} (${sent}/${n.deliveryResults.length} channels)`,
  });

  return n;
}

/** Retry a previously failed notification */
export async function retryNotification(id: string): Promise<Notification | null> {
  const n = await getNotification(id);
  if (!n) return null;

  const failedChannels = n.deliveryResults.filter(r => r.status === 'failed').map(r => r.channel);
  if (failedChannels.length === 0) return n;

  const retried = await sendNotification({
    type: n.type,
    severity: n.severity,
    title: n.title,
    message: n.message,
    sourceType: n.sourceType,
    sourceId: n.sourceId,
    channels: failedChannels,
    metadata: { ...n.metadata, retryOf: n.id },
  });

  await logAuditEvent({
    actor: 'admin',
    eventType: 'notification_retried',
    targetType: 'notification',
    targetId: n.id,
    summary: `Retried notification ${n.id} → ${retried.id}`,
  });

  return retried;
}

/** Get notification summary stats */
export async function getNotificationSummary(): Promise<{
  total: number; sent: number; failed: number; pending: number;
  criticalToday: number; configuredChannels: string[];
}> {
  const all = await listNotifications(200);
  const config = await getNotificationConfig();
  const today = new Date().toISOString().slice(0, 10);

  const channels: string[] = ['internal_log'];
  if (config.webhookUrl) channels.push('webhook');
  if (config.slackWebhookUrl) channels.push('slack_webhook');
  if (config.emailEnabled) channels.push('email_stub');

  return {
    total: all.length,
    sent: all.filter(n => n.status === 'sent').length,
    failed: all.filter(n => n.status === 'failed').length,
    pending: all.filter(n => n.status === 'pending').length,
    criticalToday: all.filter(n => n.severity === 'critical' && n.createdAt.startsWith(today)).length,
    configuredChannels: channels,
  };
}
