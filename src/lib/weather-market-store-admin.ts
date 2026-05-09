// ── Step 150: thin re-exporter for the admin-only `listAllWagers` ────────
//
// `weather-market-risk-warnings.ts` (the analyzer) imports `listAllWagers`
// through this file rather than directly from `wager-store.ts`. Two
// reasons:
//
//   1. The analyzer never needs `createWager` / `voidWager` /
//      `gradeWager` / `updateWager` / `lockExpiredWagers` etc. — it
//      only needs to *read* the wager catalog. Importing through this
//      module makes the trust boundary trivially greppable: the
//      analyzer file's only `wager-store` reference is via this shim,
//      and the shim only re-exports the read function.
//
//   2. Keeps the analyzer module's import surface stable if the
//      underlying `wager-store` is ever split (e.g. a separate read
//      module). The analyzer wouldn't have to change.
//
// **No mutation surface is exposed here.** This file does not import or
// re-export any wager-creation, settlement, grading, or wallet code.

export { listAllWagers, getWager } from './wager-store';
