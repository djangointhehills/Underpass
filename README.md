# Commute Crossings

Public dashboard for the lower Moonee Ponds Creek commute corridor, Racecourse Road to Footscray Road.

## Run locally

Requires Node.js 22 or newer; no npm dependencies.

```sh
node scripts/collect.mjs
python3 -m http.server 8000
```

Open http://localhost:8000. Run checks with `node --test tests/*.test.mjs`.

## Sources and publication

GitHub Pages publishes from `.github/workflows/publish.yml` on pushes to `main`, manual runs, and at minutes 17 and 47 each hour. Pages must use GitHub Actions as its build source. Scheduled runs can be delayed; inactive public repositories can have scheduled workflows disabled by GitHub. The page evaluates staleness from each observation's timestamp, independently of the deployment time.

The workflow reads public sources server-side because their CORS policies do not allow direct requests from this site's browser origin. It publishes a normalized `data/conditions.json` alongside the HTML and JavaScript. Generated readings are ignored by Git; only public measurements are included in the deployment. No API keys are needed.

- Melbourne Water's public rainfall/river API: Flemington `229643A` and Broadmeadows/Jacana `229665A`. River levels are metres relative to the gauge reference. Measured rain is the provider's total since 9 am, not a rolling 24-hour amount. Timestamps have no offset; the collector assumes Melbourne local time and rejects ambiguous/skipped DST times. The provider's seasonal clock convention is not confirmed.
- Ports Victoria's public OMC dashboard: Breakwater Pier observed tide, Williamstown astronomical prediction, and the provider's coincident residual. Heights are metres; the feed does not declare its datum. These heights must not be compared directly with creek gauges or underpass elevations. The anonymous dashboard endpoint is not a documented stable API. Partial feeds remain usable when another series is missing.
- Open-Meteo hourly precipitation is requested in the browser. It is modelled upstream rainfall, distinct from gauge observations. Each value covers the preceding hour; Unix timestamps avoid viewer-timezone errors.
- Community reports and official route updates are external links. The community database rejected unauthenticated reads; it is not scraped or republished. Pump operation and closures have no verified automated feeds connected.

## Personal observations

Reports remain in `localStorage` on the current device/browser. They are never sent to a server or added to the repository. Each records the crossing, direction, observation time, condition, optional note, and a compact snapshot of available measurements when saved. That snapshot is explicitly captured at save time, not retroactively at a backdated observation time. Latest 500 reports are retained. Export downloads private JSON; clearing browser data removes local history. Different devices do not sync.

Reports older than two hours are shown as history with current condition unknown. Even a fresh dry report describes an observation, not guaranteed passability. The two-hour freshness label is an interface convention, not a validated safety threshold. Outlooks show rain forecasts, predicted tides and observed creek trends without inventing a calibrated flood probability.

No private activity link, GPS track or commute endpoints are published.
