import ForecastTracker from './ForecastTracker';

export default function AdminForecasts() {
  const handleLogout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = '/admin';
  };

  return (
    <div className="space-y-6">
      {/* Admin nav tabs */}
      <div className="flex items-center justify-between">
        <nav className="flex gap-1 rounded-lg bg-gray-100 p-1">
          <a
            href="/admin/wagers"
            className="rounded-md px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            Wagers
          </a>
          <a
            href="/admin/forecasts"
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-gray-900 shadow-sm"
          >
            Forecasts
          </a>
        </nav>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          Logout
        </button>
      </div>

      {/* Forecast Tracker */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <ForecastTracker />
      </div>
    </div>
  );
}
