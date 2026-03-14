import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { sendNotification, type NotificationChannel, type NotificationSeverity } from './notifications';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface EscalationRule {
  id: string;
  eventType: string;
  severity?: string;
  channels: NotificationChannel[];
  enabled: boolean;
}

const RULES_KEY = 'escalation:rules';

/* ------------------------------------------------------------------ */
/*  Default rules                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_RULES: EscalationRule[] = [
  { id: 'esc-critical-alert', eventType: 'alert_created_critical', severity: 'critical', channels: ['webhook', 'slack_webhook', 'internal_log'], enabled: true },
  { id: 'esc-warning-alert', eventType: 'alert_created_warning', severity: 'warning', channels: ['webhook', 'internal_log'], enabled: true },
  { id: 'esc-live-order-failed', eventType: 'live_order_failed', severity: 'critical', channels: ['webhook', 'internal_log'], enabled: true },
  { id: 'esc-live-order-submitted', eventType: 'live_order_submitted', severity: 'info', channels: ['internal_log'], enabled: true },
  { id: 'esc-approval-pending', eventType: 'approval_request_pending', severity: 'warning', channels: ['internal_log', 'webhook'], enabled: true },
  { id: 'esc-missing-signoff', eventType: 'missing_signoff', severity: 'warning', channels: ['internal_log'], enabled: true },
  { id: 'esc-incident-critical', eventType: 'incident_created_critical', severity: 'critical', channels: ['webhook', 'slack_webhook', 'internal_log'], enabled: true },
  { id: 'esc-incident-high', eventType: 'incident_created_high', severity: 'warning', channels: ['webhook', 'internal_log'], enabled: true },
  { id: 'esc-venue-outage', eventType: 'venue_outage', severity: 'critical', channels: ['webhook', 'slack_webhook', 'internal_log'], enabled: true },
  { id: 'esc-recon-stale', eventType: 'reconciliation_stale_critical', severity: 'critical', channels: ['webhook'], enabled: true },
  { id: 'esc-settlement-disputed', eventType: 'settlement_discrepancy_disputed', severity: 'critical', channels: ['webhook'], enabled: true },
  { id: 'esc-kill-switch', eventType: 'kill_switch_activated', severity: 'critical', channels: ['webhook', 'slack_webhook', 'internal_log'], enabled: true },
  { id: 'esc-live-mode-enabled', eventType: 'live_mode_enabled', severity: 'warning', channels: ['webhook', 'internal_log'], enabled: true },
  { id: 'esc-emergency-shutdown', eventType: 'emergency_shutdown', severity: 'critical', channels: ['webhook', 'slack_webhook', 'internal_log'], enabled: true },
];

/* ------------------------------------------------------------------ */
/*  Storage                                                             */
/* ------------------------------------------------------------------ */

export async function getEscalationRules(): Promise<EscalationRule[]> {
  const redis = getRedis();
  const raw = await redis.get(RULES_KEY);
  if (!raw) return [];
  return typeof raw === 'string' ? JSON.parse(raw) : raw as EscalationRule[];
}

async function saveEscalationRules(rules: EscalationRule[]): Promise<void> {
  const redis = getRedis();
  await redis.set(RULES_KEY, JSON.stringify(rules));
}

export async function seedDefaultRules(): Promise<number> {
  const existing = await getEscalationRules();
  if (existing.length > 0) return 0;
  await saveEscalationRules(DEFAULT_RULES);
  return DEFAULT_RULES.length;
}

export async function updateEscalationRule(id: string, updates: {
  channels?: NotificationChannel[];
  enabled?: boolean;
}): Promise<EscalationRule | null> {
  const rules = await getEscalationRules();
  const rule = rules.find(r => r.id === id);
  if (!rule) return null;
  if (updates.channels) rule.channels = updates.channels;
  if (updates.enabled !== undefined) rule.enabled = updates.enabled;
  await saveEscalationRules(rules);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'escalation_rule_updated',
    targetType: 'escalation-rule',
    targetId: id,
    summary: `Rule ${id} updated: enabled=${rule.enabled}, channels=${rule.channels.join(',')}`,
  });
  return rule;
}

/* ------------------------------------------------------------------ */
/*  Trigger — called by event sources                                   */
/* ------------------------------------------------------------------ */

export async function triggerEscalation(input: {
  eventType: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  sourceType?: string;
  sourceId?: string;
  metadata?: any;
}): Promise<void> {
  const rules = await getEscalationRules();
  const matching = rules.filter(r => r.enabled && r.eventType === input.eventType);
  if (matching.length === 0) return;

  // Collect unique channels from matching rules
  const channels = new Set<NotificationChannel>();
  for (const rule of matching) {
    for (const ch of rule.channels) channels.add(ch);
  }

  try {
    await sendNotification({
      type: input.eventType,
      severity: input.severity,
      title: input.title,
      message: input.message,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      channels: [...channels],
      metadata: input.metadata,
    });
  } catch {
    // Notification failures must not break core workflows
  }
}
