// Public read-only adapter for Ports Victoria's embedded OMC dashboard.
// This is an integration sample, not a documented/stable upstream API contract.
export const tideEndpoint = 'https://portweather-public.omcinternational.com/api/ds/query';
export const tideDashboard = 'https://portweather-public.omcinternational.com/d/d3cdd299-960b-42ea-9ec3-14dff46bc767/breakwater-pier';

export function buildTideQuery(nowMs = Date.now()) {
  const observedPath = 'AU/VIC/Melbourne/Tides/Measured/Breakwater Pier/Breakwater Pier Failover';
  const entries = [
    ['A', 'AU/VIC/Melbourne/Tides/Astros/Williamstown_p3', 'tideHeight_m', 'AstronomicalTidePlot', '*'],
    ['B', observedPath, 'tideHeight_m', 'MeasuredTidePlot', 'GOOD_DATA'],
    ['C', observedPath, 'residual_m', 'MeasuredTidePlot', 'GOOD_DATA'],
  ];
  return {
    from: new Date(nowMs - 3 * 3600000).toISOString(),
    to: new Date(nowMs + 24 * 3600000).toISOString(),
    queries: entries.map(([refId, sourcePath, sourceProperty, transformerType, qastatus]) => ({
      refId, sourcePath, sourceProperty, transformerType, qastatus,
      target: refId, type: 'timeseries', datasourceId: 391,
      options: { calculatePacketAge: false, returnLatestOnly: false },
    })),
  };
}

function readSeries(payload, refId) {
  const result = payload?.results?.[refId];
  if (!result || result.error) throw new Error(`Tide series ${refId} unavailable`);
  // The tested upstream returns HTTP 200 with result.status=500 even for valid
  // frames. Validate the actual frame/error fields; preserve this anomaly below.
  const pairs = new Map();
  for (const frame of result.frames ?? []) {
    const fields = frame.schema?.fields ?? [];
    const timeIndex = fields.findIndex(field => field.type === 'time');
    const valueIndex = fields.findIndex(field => field.name === 'Value' && field.type === 'number');
    const times = frame.data?.values?.[timeIndex];
    const values = frame.data?.values?.[valueIndex];
    if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) continue;
    times.forEach((timestampMs, i) => {
      const metres = values[i];
      if (Number.isFinite(timestampMs) && timestampMs > 1e12 && Number.isFinite(metres) && metres !== -999999) {
        pairs.set(timestampMs, { timestamp: new Date(timestampMs).toISOString(), timestampMs, metres });
      }
    });
  }
  if (!pairs.size) throw new Error(`Tide series ${refId} has no valid samples`);
  return [...pairs.values()].sort((left, right) => left.timestampMs - right.timestampMs);
}

export function parseTides(payload, nowMs = Date.now()) {
  const optionalSeries = id => { try { return readSeries(payload, id); } catch { return []; } };
  const predictions = optionalSeries('A');
  const observed = optionalSeries('B').filter(point => point.timestampMs <= nowMs);
  const residuals = optionalSeries('C');
  const latest = observed.at(-1) ?? null;
  if (!latest && !predictions.length) throw new Error('No tide observations or predictions');
  const residual = latest && residuals.find(point => point.timestampMs === latest.timestampMs) || null;
  const coincidentPrediction = latest && predictions.find(point => point.timestampMs === latest.timestampMs) || null;
  const residualVerified = !!(residual && coincidentPrediction && Math.abs(latest.metres - coincidentPrediction.metres - residual.metres) <= 0.003);
  return {
    provider: 'Ports Victoria / OMC public dashboard',
    sourceUrl: tideDashboard,
    observedStation: 'Breakwater Pier',
    predictionStation: 'Williamstown',
    units: 'm',
    datum: null,
    datumNote: 'The public feed does not declare its vertical datum; do not compare absolute heights with creek gauges or path elevations.',
    retrievedAt: new Date(nowMs).toISOString(),
    latestObservation: latest,
    observationAgeMinutes: latest ? (nowMs - latest.timestampMs) / 60000 : null,
    observed,
    astronomicalPredictions: predictions.filter(point => point.timestampMs >= nowMs && point.timestampMs <= nowMs + 24 * 3600000),
    providerResidual: residualVerified ? residual : null,
    residualVerifiedAgainstPrediction: residualVerified,
    upstreamSeriesStatuses: Object.fromEntries(['A', 'B', 'C'].map(refId => [refId, payload?.results?.[refId]?.status ?? null])),
  };
}

export async function fetchPublicTides(nowMs = Date.now()) {
  const response = await fetch(tideEndpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTideQuery(nowMs)), signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Tide upstream HTTP ${response.status}`);
  return parseTides(await response.json(), nowMs);
}
