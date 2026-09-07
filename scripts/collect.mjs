import { mkdir, writeFile } from 'node:fs/promises';
import { fetchGauge } from './gauges.mjs';
import { fetchPublicTides } from './tides.mjs';
import { parseMelbourneTime } from '../conditions.mjs';

const now = Date.now();
const generatedAt = new Date(now).toISOString();
const toPoint = p => {
  const time = parseMelbourneTime(p.observedAtLocal.slice(0, 16));
  return Number.isFinite(time) ? { time: new Date(time).toISOString(), value: p.value } : null;
};
const tidePoint = p => ({ time: p.timestamp, value: p.metres });
async function collectGauge(id) {
  try {
    const gauge = await fetchGauge(id);
    const rainTime = gauge.rainfall?.observedAtLocal && parseMelbourneTime(gauge.rainfall.observedAtLocal.slice(0, 16));
    return {
      id, name: gauge.name, status: 'available', sourceUrl: gauge.source,
      timestampNote: gauge.timestampConvention.status,
      warning: gauge.warning,
      level: (gauge.river?.points.length ? gauge.river.points : gauge.river?.observedAtLocal ? [{ observedAtLocal: gauge.river.observedAtLocal, value: gauge.river.level }] : []).map(toPoint).filter(Boolean),
      rainSince9am: Number.isFinite(rainTime) && Number.isFinite(gauge.rainfall?.since9am)
        ? { time: new Date(rainTime).toISOString(), value: gauge.rainfall.since9am } : null,
    };
  } catch (error) {
    console.warn(`Gauge ${id}: ${error.message}`);
    return { id, name: id === '229643A' ? 'Flemington' : 'Broadmeadows / Jacana', status: 'unavailable', level: [], rainSince9am: null };
  }
}
async function collectTides() {
  try {
    const tide = await fetchPublicTides(now);
    return {
      status: 'available', sourceUrl: tide.sourceUrl,
      observedStation: tide.observedStation, predictionStation: tide.predictionStation,
      datum: tide.datum, datumNote: tide.datumNote,
      observed: tide.observed.map(tidePoint), predicted: tide.astronomicalPredictions.map(tidePoint),
      residual: tide.providerResidual ? tidePoint(tide.providerResidual) : null,
    };
  } catch (error) {
    console.warn(`Tides: ${error.message}`);
    return { status: 'unavailable', observed: [], predicted: [], residual: null };
  }
}
const [flemington, jacana, tides] = await Promise.all([collectGauge('229643A'), collectGauge('229665A'), collectTides()]);
const result = { schemaVersion: 1, generatedAt, gauges: [flemington, jacana], tides };
await mkdir('data', { recursive: true });
await writeFile('data/conditions.json', JSON.stringify(result));
console.log(JSON.stringify({ generatedAt, gauges: result.gauges.map(g => ({ id: g.id, status: g.status, samples: g.level.length })), tides: tides.status }));
