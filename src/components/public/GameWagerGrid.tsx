// Simple grid of WagerCard for a single game's markets — the destination
// Weatherboard Extended links to ("all of the wagers for that game"), added
// 2026-08-23 per Derek. Deliberately no filter/search UI (unlike
// PublicWagerList) since the list is already scoped to one game.
import React from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';
import WagerCard from './WagerCard';

interface Props {
  wagers: PublicWagerView[];
}

export default function GameWagerGrid({ wagers }: Props) {
  if (wagers.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No published markets for this game yet.
      </p>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {wagers.map(w => (
        <li key={w.id}>
          <WagerCard wager={w} />
        </li>
      ))}
    </ul>
  );
}
