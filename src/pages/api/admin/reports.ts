import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/admin-auth';
import { generateReport, reportToCSV, REPORT_TYPES, type ReportType, type ReportFilters } from '../../../lib/reporting';
import { logAuditEvent } from '../../../lib/audit-log';

export const prerender = false;

function parseFilters(url: URL): ReportFilters {
  return {
    dateFrom: url.searchParams.get('dateFrom') || undefined,
    dateTo: url.searchParams.get('dateTo') || undefined,
    source: url.searchParams.get('source') || undefined,
    mode: url.searchParams.get('mode') || undefined,
    confidence: url.searchParams.get('confidence') || undefined,
    sizingTier: url.searchParams.get('sizingTier') || undefined,
    ticker: url.searchParams.get('ticker') || undefined,
  };
}

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const reportType = url.searchParams.get('reportType') as ReportType | null;
    const format = url.searchParams.get('format');
    const filters = parseFilters(url);

    // If no report type, return available report types
    if (!reportType) {
      return new Response(JSON.stringify({ reportTypes: REPORT_TYPES }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const validTypes: ReportType[] = ['daily', 'pnl', 'reconciliation', 'signal', 'market'];
    if (!validTypes.includes(reportType)) {
      return new Response(JSON.stringify({ error: `Invalid reportType: ${reportType}` }), { status: 400 });
    }

    const report = await generateReport(reportType, filters);

    // Export format
    if (format === 'csv') {
      const csv = reportToCSV(report);

      await logAuditEvent({
        actor: 'admin',
        eventType: 'report_exported',
        targetType: 'report',
        summary: `Report exported: ${reportType} as CSV`,
        details: { filters },
      }).catch(() => {});

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${reportType}-report-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    if (format === 'json-download') {
      const json = JSON.stringify(report, null, 2);

      await logAuditEvent({
        actor: 'admin',
        eventType: 'report_exported',
        targetType: 'report',
        summary: `Report exported: ${reportType} as JSON`,
        details: { filters },
      }).catch(() => {});

      return new Response(json, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${reportType}-report-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      });
    }

    // Default: preview
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || 'Failed' }), { status: 500 });
  }
};
