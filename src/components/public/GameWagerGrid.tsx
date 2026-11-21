// Simple grid of WagerCard for a single game's markets — the destination
// Weatherboard Extended links to ("all of the wagers for that game"), added
// 2026-08-23 per Derek. Deliberately no filter/search UI (unlike
// PublicWagerList) since the list is already scoped to one game.
//
// 2026-11-20 (DBD, WOW-038): an open market clicked while signed out opens the
// sign-up prompt in place; signed in, the card goes to the market's page, where
// the existing weather bet slip is. A market that is not open (locked at game
// time, graded, void) is not clickable, and a locked one says so.
import React, { useState } from 'react';
import type { PublicWagerView } from '../../lib/public-wager-view';
import WagerCard from './WagerCard';
import SignUpPrompt from '../auth/SignUpPrompt';
import { useSignedIn } from '../../lib/client/use-signed-in';

interface Props {
  wagers: PublicWagerView[];
}

/** What a click on a weather card does. Exported for tests. */
export function weatherCardClick(status: string, signedIn: boolean | null): 'none' | 'signup' | 'open-page' {
  if (status !== 'open') return 'none';
  if (signedIn === false) return 'signup';
  return 'open-page';
}

export default function GameWagerGrid({ wagers }: Props) {
  const signedIn = useSignedIn();
  const [prompt, setPrompt] = useState(false);
  if (wagers.length === 0) {
    return (
      <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        No published markets for this game yet.
      </p>
    );
  }
  return (
    <>
      <ul className="grid gap-4 md:grid-cols-2">
        {wagers.map(w => {
          const open = w.status === 'open';
          return (
            <li
              key={w.id}
              onClickCapture={(e) => {
                if (weatherCardClick(w.status, signedIn) === 'signup') {
                  e.preventDefault();
                  setPrompt(true);
                }
              }}
            >
              {w.status === 'locked' && (
                <p className="mb-1 text-xs font-semibold text-amber-700">Locked at game time</p>
              )}
              <WagerCard wager={w} full noLink={!open} />
            </li>
          );
        })}
      </ul>
      {prompt && <SignUpPrompt onClose={() => setPrompt(false)} />}
    </>
  );
}
