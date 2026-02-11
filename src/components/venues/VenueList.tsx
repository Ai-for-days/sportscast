import { useState, useEffect } from 'react';
import type { Venue, SportType } from '../../lib/types';

const sportLabels: Record<string, string> = {
  '': 'All Sports',
  baseball: 'Baseball',
  football: 'Football',
  soccer: 'Soccer',
  tennis: 'Tennis',
  golf: 'Golf',
  youth: 'Youth',
  multi: 'Multi-Sport',
};

const typeIcons: Record<string, string> = {
  outdoor: '🏟️',
  indoor: '🏢',
  retractable: '🔄',
};

const sportColors: Record<string, string> = {
  baseball: 'bg-field/10 text-field-dark',
  football: 'bg-heat/10 text-heat-dark',
  soccer: 'bg-sky/10 text-sky-dark',
  tennis: 'bg-storm/10 text-storm-dark',
  golf: 'bg-field/10 text-field-dark',
  youth: 'bg-surface-alt text-text-muted',
  multi: 'bg-surface-alt text-text-muted',
};

interface Props {
  initialVenues: Venue[];
}

export default function VenueList({ initialVenues }: Props) {
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [sport, setSport] = useState('');
  const [search, setSearch] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem('sportscast-favorites');
    if (stored) setFavorites(JSON.parse(stored));
  }, []);

  useEffect(() => {
    let filtered = initialVenues;
    if (sport) {
      filtered = filtered.filter(v => v.sport === sport);
    }
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(v =>
        v.name.toLowerCase().includes(q) ||
        v.city.toLowerCase().includes(q) ||
        v.state.toLowerCase().includes(q)
      );
    }
    setVenues(filtered);
  }, [sport, search, initialVenues]);

  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id)
      ? favorites.filter(f => f !== id)
      : [...favorites, id];
    setFavorites(next);
    localStorage.setItem('sportscast-favorites', JSON.stringify(next));
  };

  const favoriteVenues = venues.filter(v => favorites.includes(v.id));
  const otherVenues = venues.filter(v => !favorites.includes(v.id));

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 sm:min-w-64">
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search venues..."
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-4 text-sm outline-none focus:border-field dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark"
          />
        </div>
        <select
          value={sport}
          onChange={e => setSport(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm dark:border-border-dark dark:bg-surface-dark-alt dark:text-text-dark"
        >
          {Object.entries(sportLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <p className="text-sm text-text-muted dark:text-text-dark-muted">
        {venues.length} venues found
      </p>

      {/* Favorites section */}
      {favoriteVenues.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-text-muted dark:text-text-dark-muted">
            Favorites
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteVenues.map(venue => (
              <VenueCardReact key={venue.id} venue={venue} isFavorite onToggleFavorite={toggleFavorite} />
            ))}
          </div>
        </div>
      )}

      {/* All venues */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {otherVenues.map(venue => (
          <VenueCardReact
            key={venue.id}
            venue={venue}
            isFavorite={false}
            onToggleFavorite={toggleFavorite}
          />
        ))}
      </div>
    </div>
  );
}

function VenueCardReact({ venue, isFavorite, onToggleFavorite }: { venue: Venue; isFavorite: boolean; onToggleFavorite: (id: string) => void }) {
  return (
    <div className="group rounded-xl border border-border bg-surface p-4 shadow-sm transition-all hover:shadow-md dark:border-border-dark dark:bg-surface-dark-alt">
      <div className="mb-2 flex items-start justify-between">
        <a href={`/venues/${venue.id}`} className="text-sm font-semibold text-text group-hover:text-field dark:text-text-dark dark:group-hover:text-field-light">
          {venue.name}
        </a>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onToggleFavorite(venue.id)}
            className="text-lg transition-transform hover:scale-110"
            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            {isFavorite ? '⭐' : '☆'}
          </button>
          <span className="text-base">{typeIcons[venue.type]}</span>
        </div>
      </div>
      <p className="text-xs text-text-muted dark:text-text-dark-muted">
        {venue.city}, {venue.state}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${sportColors[venue.sport] || ''}`}>
          {venue.sport}
        </span>
        <span className="text-xs text-text-muted dark:text-text-dark-muted">
          {venue.capacity > 0 ? `${venue.capacity.toLocaleString()} seats` : ''}
        </span>
      </div>
    </div>
  );
}
