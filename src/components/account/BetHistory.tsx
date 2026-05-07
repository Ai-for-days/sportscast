// ── Step 122: BetHistory consolidated onto MyBets ───────────────────────────
//
// Previously this file rendered its own EnrichedBet-shaped cards via the
// Step 121 compatibility adapter. Step 122 collapses both customer bet-list
// surfaces (PlayerDashboard + AccountDashboard) onto a single source of
// truth: MyBets, which consumes SafeCustomerBetView directly. Keeping
// the named export so AccountDashboard's import doesn't change.

import React from 'react';
import MyBets from '../player/MyBets';

export default function BetHistory() {
  return <MyBets />;
}
