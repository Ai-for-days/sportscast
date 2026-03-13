import { getRedis } from './redis';
import { logAuditEvent } from './audit-log';
import { runHealthChecks, type HealthCheck } from './execution-health';

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  createdAt: string;
  severity: AlertSeverity;
  type: string;
  title: string;
  message: string;
  status: AlertStatus;
  link?: string;
  metadata?: any;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

/* ------------------------------------------------------------------ */
/*  Redis keys                                                          */
/* ------------------------------------------------------------------ */

const ALERT_PREFIX = 'alert:';
const ALERT_SET = 'alerts:all';

/* ------------------------------------------------------------------ */
/*  CRUD                                                                */
/* ------------------------------------------------------------------ */

async function saveAlert(alert: Alert): Promise<void> {
  const redis = getRedis();
  await redis.set(`${ALERT_PREFIX}${alert.id}`, JSON.stringify(alert));
  await redis.zadd(ALERT_SET, { score: Date.now(), member: alert.id });
}

export async function getAlert(id: string): Promise<Alert | null> {
  const redis = getRedis();
  const raw = await redis.get(`${ALERT_PREFIX}${id}`);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Alert;
}

export async function listAlerts(limit = 100): Promise<Alert[]> {
  const redis = getRedis();
  const ids = await redis.zrange(ALERT_SET, 0, limit - 1, { rev: true });
  if (!ids || ids.length === 0) return [];
  const alerts: Alert[] = [];
  for (const id of ids) {
    const raw = await redis.get(`${ALERT_PREFIX}${id}`);
    if (raw) alerts.push(typeof raw === 'string' ? JSON.parse(raw) : raw as unknown as Alert);
  }
  return alerts;
}

/* ------------------------------------------------------------------ */
/*  Alert actions                                                       */
/* ------------------------------------------------------------------ */

export async function acknowledgeAlert(id: string): Promise<Alert | null> {
  const alert = await getAlert(id);
  if (!alert) return null;
  alert.status = 'acknowledged';
  alert.acknowledgedAt = new Date().toISOString();
  await saveAlert(alert);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'alert_acknowledged',
    targetType: 'alert',
    targetId: id,
    summary: `Alert acknowledged: ${alert.title}`,
  });
  return alert;
}

export async function resolveAlert(id: string): Promise<Alert | null> {
  const alert = await getAlert(id);
  if (!alert) return null;
  alert.status = 'resolved';
  alert.resolvedAt = new Date().toISOString();
  await saveAlert(alert);
  await logAuditEvent({
    actor: 'admin',
    eventType: 'alert_resolved',
    targetType: 'alert',
    targetId: id,
    summary: `Alert resolved: ${alert.title}`,
  });
  return alert;
}

export async function clearResolved(): Promise<number> {
  const alerts = await listAlerts(500);
  const resolved = alerts.filter(a => a.status === 'resolved');
  const redis = getRedis();
  for (const a of resolved) {
    await redis.del(`${ALERT_PREFIX}${a.id}`);
    await redis.zrem(ALERT_SET, a.id);
  }
  return resolved.length;
}

/* ------------------------------------------------------------------ */
/*  Create alert (deduplication by type within 10 minutes)              */
/* ------------------------------------------------------------------ */

async function createAlert(
  severity: AlertSeverity,
  type: string,
  title: string,
  message: string,
  link?: string,
  metadata?: any,
): Promise<Alert> {
  // Deduplicate: skip if same type+severity alert created in last 10 min and still open
  const recent = await listAlerts(50);
  const dup = recent.find(a =>
    a.type === type && a.severity === severity && a.status === 'open' &&
    (Date.now() - new Date(a.createdAt).getTime()) < 600000
  );
  if (dup) return dup;

  const alert: Alert = {
    id: `alrt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    severity,
    type,
    title,
    message,
    status: 'open',
    link,
    metadata,
  };

  await saveAlert(alert);

  await logAuditEvent({
    actor: 'system',
    eventType: 'alert_created',
    targetType: 'alert',
    targetId: alert.id,
    summary: `Alert created: [${severity}] ${title}`,
  });

  return alert;
}

/* ------------------------------------------------------------------ */
/*  Generate alerts from health checks + system state                   */
/* ------------------------------------------------------------------ */

export async function generateAlerts(): Promise<Alert[]> {
  const checks = await runHealthChecks();
  const generated: Alert[] = [];

  // Alerts from health checks
  for (const check of checks) {
    if (check.status === 'critical') {
      const alert = await createAlert(
        'critical', `health_${check.key}`, `${check.label} — Critical`, check.message,
        '/admin/alerts', { healthCheck: check.key },
      );
      generated.push(alert);
    } else if (check.status === 'warning') {
      const alert = await createAlert(
        'warning', `health_${check.key}`, `${check.label} — Warning`, check.message,
        '/admin/alerts', { healthCheck: check.key },
      );
      generated.push(alert);
    }
  }

  // Additional system-level alerts
  const redis = getRedis();

  // Kill switch active
  try {
    const ksRaw = await redis.get('kill-switch');
    if (ksRaw) {
      const ks = typeof ksRaw === 'string' ? JSON.parse(ksRaw) : ksRaw as any;
      if (ks.active) {
        const a = await createAlert('critical', 'kill_switch_active', 'Kill Switch Active', 'Kill switch is currently engaged. All execution halted.', '/admin/execution-control');
        generated.push(a);
      }
    }
  } catch { /* ignore */ }

  // High unreconciled count
  try {
    const reconIds = await redis.zrange('recon:all', 0, -1);
    let unreconciled = 0;
    for (const id of (reconIds || []).slice(0, 100)) {
      const raw = await redis.get(`recon:record:${id}`);
      if (!raw) continue;
      const rec = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (rec.discrepancy && rec.status !== 'reviewed') unreconciled++;
    }
    if (unreconciled >= 5) {
      const a = await createAlert('warning', 'high_unreconciled', 'High Unreconciled Count', `${unreconciled} unreconciled discrepancies`, '/admin/reconciliation');
      generated.push(a);
    }
  } catch { /* ignore */ }

  // Stale repricing queue
  try {
    const rpIds = await redis.zrange('reprice:applied:all', 0, 0, { rev: true });
    if (rpIds && rpIds.length > 0) {
      const raw = await redis.get(`reprice:applied:${rpIds[0]}`);
      if (raw) {
        const last = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const ageH = (Date.now() - new Date(last.appliedAt).getTime()) / 3600000;
        if (ageH > 24) {
          const a = await createAlert('info', 'stale_repricing', 'Repricing Queue Stale', `No repricing applied in ${Math.round(ageH)}h`, '/admin/market-making');
          generated.push(a);
        }
      }
    }
  } catch { /* ignore */ }

  // Live readiness degraded
  try {
    const lrRaw = await redis.get('live-trading-config');
    if (lrRaw) {
      const cfg = typeof lrRaw === 'string' ? JSON.parse(lrRaw) : lrRaw as any;
      if (cfg.enabled) {
        // Check if preflight is stale
        const pfRaw = await redis.get('live-preflight:latest');
        if (pfRaw) {
          const pf = typeof pfRaw === 'string' ? JSON.parse(pfRaw) : pfRaw;
          const ageMin = (Date.now() - new Date(pf.completedAt || pf.createdAt).getTime()) / 60000;
          if (ageMin > 240) {
            const a = await createAlert('warning', 'preflight_stale', 'Live Preflight Expired', `Preflight completed ${Math.round(ageMin)}m ago`, '/admin/live-readiness');
            generated.push(a);
          }
        }
      }
    }
  } catch { /* ignore */ }

  return generated;
}

/* ------------------------------------------------------------------ */
/*  Summary for dashboard integration                                   */
/* ------------------------------------------------------------------ */

export interface AlertSummary {
  openCritical: number;
  openWarnings: number;
  openInfo: number;
  total: number;
}

export async function getAlertSummary(): Promise<AlertSummary> {
  const alerts = await listAlerts(200);
  const open = alerts.filter(a => a.status === 'open');
  return {
    openCritical: open.filter(a => a.severity === 'critical').length,
    openWarnings: open.filter(a => a.severity === 'warning').length,
    openInfo: open.filter(a => a.severity === 'info').length,
    total: alerts.length,
  };
}
