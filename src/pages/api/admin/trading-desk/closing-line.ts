import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-auth';
import { listAllWagers } from '../../../../lib/wager-store';
import type { Wager, OverUnderWager, PointspreadWager, OddsWager } from '../../../../lib/wager-types';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const allWagers = await listAllWagers(200);

    const openToCloseDrifts: number[] = [];
    const modelToOpenDrifts: number[] = [];
    const modelToCloseDrifts: number[] = [];

    const markets: any[] = [];

    for (const w of allWagers) {
      const opening = w.openingLineSnapshot;
      const closing = w.closingLineSnapshot;
      const snap = w.pricingSnapshot;

      // Get current line values
      let openingSummary = '—';
      let closingSummary = '—';
      let modelSummary = '—';
      let openToCloseDrift: number | null = null;
      let modelToOpenDrift: number | null = null;
      let modelToCloseDrift: number | null = null;
      let actualResult = '—';
      let actualVsOpenDrift: number | null = null;
      let actualVsCloseDrift: number | null = null;
      let movedTowardModel: boolean | null = null;

      if (w.kind === 'over-under') {
        const ew = w as OverUnderWager;
        const openLine = opening?.overUnder?.line;
        const closeLine = closing?.overUnder?.line ?? ew.line;
        const modelLine = snap?.overUnder?.suggestedLine;

        if (openLine != null) openingSummary = `Line ${openLine} (O ${opening?.overUnder?.overOdds} / U ${opening?.overUnder?.underOdds})`;
        closingSummary = `Line ${closeLine} (O ${closing?.overUnder?.overOdds ?? ew.over.odds} / U ${closing?.overUnder?.underOdds ?? ew.under.odds})`;
        if (modelLine != null) modelSummary = `Line ${modelLine}`;

        if (openLine != null) {
          openToCloseDrift = closeLine - openLine;
          openToCloseDrifts.push(openToCloseDrift);
        }
        if (modelLine != null && openLine != null) {
          modelToOpenDrift = openLine - modelLine;
          modelToOpenDrifts.push(modelToOpenDrift);
        }
        if (modelLine != null) {
          modelToCloseDrift = closeLine - modelLine;
          modelToCloseDrifts.push(modelToCloseDrift);
        }

        if (w.observedValue != null) {
          actualResult = `${w.observedValue}`;
          if (openLine != null) actualVsOpenDrift = w.observedValue - openLine;
          actualVsCloseDrift = w.observedValue - closeLine;
        }

        if (modelLine != null && openLine != null && openToCloseDrift != null) {
          const openDistFromModel = Math.abs(openLine - modelLine);
          const closeDistFromModel = Math.abs(closeLine - modelLine);
          movedTowardModel = closeDistFromModel < openDistFromModel;
        }
      } else if (w.kind === 'pointspread') {
        const ew = w as PointspreadWager;
        const openSpread = opening?.pointspread?.spread;
        const closeSpread = closing?.pointspread?.spread ?? ew.spread;
        const modelSpread = snap?.pointspread?.suggestedSpread;

        if (openSpread != null) openingSummary = `Spread ${openSpread}`;
        closingSummary = `Spread ${closeSpread}`;
        if (modelSpread != null) modelSummary = `Spread ${modelSpread}`;

        if (openSpread != null) {
          openToCloseDrift = closeSpread - openSpread;
          openToCloseDrifts.push(openToCloseDrift);
        }
        if (modelSpread != null && openSpread != null) {
          modelToOpenDrift = openSpread - modelSpread;
          modelToOpenDrifts.push(modelToOpenDrift);
        }
        if (modelSpread != null) {
          modelToCloseDrift = closeSpread - modelSpread;
          modelToCloseDrifts.push(modelToCloseDrift);
        }

        if (ew.observedValueA != null && ew.observedValueB != null) {
          const diff = ew.observedValueA - ew.observedValueB;
          actualResult = `${diff.toFixed(1)}`;
          if (openSpread != null) actualVsOpenDrift = diff - openSpread;
          actualVsCloseDrift = diff - closeSpread;
        }

        if (modelSpread != null && openSpread != null && openToCloseDrift != null) {
          const openDist = Math.abs(openSpread - modelSpread);
          const closeDist = Math.abs(closeSpread - modelSpread);
          movedTowardModel = closeDist < openDist;
        }
      } else if (w.kind === 'odds') {
        const ew = w as OddsWager;
        if (opening?.rangeOdds) {
          openingSummary = `${opening.rangeOdds.bands.length} bands`;
        }
        if (closing?.rangeOdds) {
          closingSummary = `${closing.rangeOdds.bands.length} bands`;
        } else {
          closingSummary = `${ew.outcomes.length} bands`;
        }
        if (w.winningOutcome) actualResult = w.winningOutcome;
      }

      // Only include markets that have at least an opening snapshot or closing snapshot
      if (!opening && !closing && !snap) continue;

      markets.push({
        id: w.id,
        ticketNumber: w.ticketNumber,
        title: w.title,
        kind: w.kind,
        status: w.status,
        openingSummary,
        closingSummary,
        modelSummary,
        openToCloseDrift,
        modelToOpenDrift,
        modelToCloseDrift,
        actualResult,
        actualVsOpenDrift,
        actualVsCloseDrift,
        movedTowardModel,
      });
    }

    const avg = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;

    const marketsWithBothSnapshots = allWagers.filter(w => w.openingLineSnapshot && w.closingLineSnapshot).length;
    const totalGraded = allWagers.filter(w => w.status === 'graded').length;

    return new Response(JSON.stringify({
      metrics: {
        avgOpenToCloseDrift: avg(openToCloseDrifts),
        avgModelToOpenDrift: avg(modelToOpenDrifts),
        avgModelToCloseDrift: avg(modelToCloseDrifts),
        marketsWithBothSnapshots,
        totalGraded,
      },
      markets,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Failed' }), { status: 500 });
  }
};
