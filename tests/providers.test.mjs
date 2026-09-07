import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTides } from '../scripts/tides.mjs';
import { extractGauge, fetchGauge } from '../scripts/gauges.mjs';
import { parseMelbourneTime } from '../conditions.mjs';

const now = Date.parse('2026-09-07T12:00Z');
function frame(times, values) {
  return { status: 500, frames: [{ schema: { fields: [{ type: 'time', name: 'Time' }, { type: 'number', name: 'Value' }] }, data: { values: [times, values] } }] };
}
test('tides read typed frame columns and only use a matching provider residual', () => {
  const payload = { results: {
    A: frame([now - 180000, now + 180000], [0.8, 0.9]),
    B: frame([now - 180000], [1]), C: frame([now - 180000], [0.2]),
  } };
  const result = parseTides(payload, now);
  assert.equal(result.latestObservation.metres, 1);
  assert.equal(result.astronomicalPredictions[0].metres, 0.9);
  assert.equal(result.providerResidual.metres, 0.2);
  assert.equal(result.datum, null);
  payload.results.C = frame([now - 180000], [3]);
  assert.equal(parseTides(payload, now).providerResidual, null);
});

test('missing observed tide does not discard a valid astronomical forecast', () => {
  const result = parseTides({ results: { A: frame([now + 180000], [0.9]) } }, now);
  assert.equal(result.astronomicalPredictions.length, 1);
  assert.equal(result.latestObservation, null);
  assert.equal(result.providerResidual, null);
});

test('gauge zero rain is retained and null water levels are not converted into zero', () => {
  const result = extractGauge({ siteId: '229643A',
    summary: { rainfallLevels: { rainfallSince9am: 0, updateDateTime: '2026-09-07T21:30:00' } },
    riverLive: { liveRiverLevelsData: [{ dateTime: '2026-09-07 21:30:00', meanRiverLevel: null }, { dateTime: '2026-09-07 21:24:00', meanRiverLevel: 0.2 }] },
    location: { siteWarningReported: false, siteWarningMessage: 'generic warning' },
  });
  assert.equal(result.rainfall.since9am, 0);
  assert.equal(result.river.level, 0.2);
  assert.equal(result.river.observedAtLocal, '2026-09-07T21:24:00');
  assert.equal(result.warning, null);
});

test('Melbourne wall times convert independently of host zone, rejecting DST ambiguity', () => {
  assert.equal(parseMelbourneTime('2026-09-07T12:30'), Date.parse('2026-09-07T02:30Z'));
  assert.equal(parseMelbourneTime('2026-01-07T12:30'), Date.parse('2026-01-07T01:30Z'));
  assert.ok(Number.isNaN(parseMelbourneTime('2026-04-05T02:30')));
  assert.ok(Number.isNaN(parseMelbourneTime('2026-10-04T02:30')));
});

test('a summary outage leaves the independently available creek series usable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.endsWith('/summary')) throw new Error('summary offline');
    if (url.endsWith('/river-level/live')) return { ok: true, json: async () => ({ liveRiverLevelsData: [{ dateTime: '2026-09-07 21:30:00', meanRiverLevel: 0.203 }] }) };
    throw new Error('Unnecessary endpoint unavailable');
  };
  try {
    const result = await fetchGauge('229643A');
    assert.equal(result.river.level, 0.203);
    assert.equal(result.rainfall, null);
  } finally { globalThis.fetch = originalFetch; }
});
