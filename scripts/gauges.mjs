// Public Melbourne Water website API. No keys, cookies or credentials required.
// Server-side use: API CORS only permits https://www.melbournewater.com.au.
export const BASE = 'https://api.melbournewater.com.au/rainfall-river-level';
export const STATIONS = {
  '229643A': {name: 'Flemington', latitude: -37.7815, longitude: 144.939},
  '229665A': {name: 'Broadmeadows', latitude: -37.6971, longitude: 144.903},
  '586182': {name: 'Essendon', latitude: -37.7242, longitude: 144.904},
  '586028': {name: 'Greenvale Reservoir', latitude: -37.637, longitude: 144.91},
};
const finite = value => typeof value === 'number' && Number.isFinite(value);
function localTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const result = value.replace(' ', 'T');
  return result.length === 16 ? result + ':00' : result;
}
// Civil-clock coordinate for differences only. NOT an observation UTC timestamp.
// This cannot resolve the repeated local hour during a DST transition.
function civilCoordinate(local) {
  const [y,m,d,h,minute,s] = local.split(/[-T:]/).map(Number);
  return Date.UTC(y,m-1,d,h,minute,s);
}
function points(payload, key, valueKey) {
  if (!Array.isArray(payload?.[key])) throw new Error(`Missing ${key}`);
  return payload[key].flatMap(row => {
    const observedAtLocal = localTime(row.dateTime);
    return observedAtLocal && finite(row[valueKey]) ? [{observedAtLocal, value:row[valueKey]}] : [];
  }).sort((a,b)=>a.observedAtLocal.localeCompare(b.observedAtLocal));
}
export function extractGauge({siteId, summary, riverLive, rainLive, location, retrievedAt = new Date().toISOString()}) {
  const riverPoints = riverLive ? points(riverLive,'liveRiverLevelsData','meanRiverLevel') : [];
  const rainPoints = rainLive ? points(rainLive,'liveRainfallLevelsData','cumulativeRainfallLevel') : [];
  const latest = riverPoints.at(-1);
  const oneHourAgo = latest && riverPoints.findLast(p => civilCoordinate(latest.observedAtLocal)-civilCoordinate(p.observedAtLocal)>=3600000);
  const elapsedMinutes = oneHourAgo ? (civilCoordinate(latest.observedAtLocal)-civilCoordinate(oneHourAgo.observedAtLocal))/60000 : null;
  const delta = oneHourAgo && elapsedMinutes <= 70 ? Number((latest.value-oneHourAgo.value).toFixed(3)) : null;
  const reported = summary?.rainfallLevels;
  const riverSummary = summary?.riverLevels;
  const since9am = finite(reported?.rainfallSince9am) ? reported.rainfallSince9am : null;
  return {
    siteId,
    name: location?.siteName ?? STATIONS[siteId]?.name ?? siteId,
    latitude: location?.latitude ?? STATIONS[siteId]?.latitude ?? null,
    longitude: location?.longitude ?? STATIONS[siteId]?.longitude ?? null,
    source: `${BASE}/${siteId}/summary`,
    retrievedAt,
    timestampConvention: {
      rawFormat:'YYYY-MM-DDTHH:mm:ss',
      offsetProvided:false,
      assumedZone:'Australia/Melbourne',
      status:'Melbourne local time inferred from current sample; seasonal DST convention unverified',
    },
    warning: location?.siteWarningReported === true ? (location.siteWarningMessage || 'Provider reports a station warning') : null,
    river: latest ? {
      unit:'m', level:latest.value, observedAtLocal:latest.observedAtLocal,
      change1hM:delta, changeReferenceAtLocal:delta === null ? null : oneHourAgo.observedAtLocal,
      changeElapsedMinutes:delta === null ? null : elapsedMinutes,
      trend1h:delta === null ? null : delta > 0 ? 'rising' : delta < 0 ? 'falling' : 'steady',
      points:riverPoints,
    } : riverSummary && finite(riverSummary.currentLevel) ? {
      unit:'m',level:riverSummary.currentLevel,observedAtLocal:localTime(riverSummary.updateDateTime),
      change1hM:null,changeReferenceAtLocal:null,changeElapsedMinutes:null,trend1h:null,points:[],
    } : null,
    rainfall: reported ? {
      unit:'mm', since9am, observedAtLocal:localTime(reported.updateDateTime),
      // Keep provider name: observed daily rain is not a rolling 24-hour forecast.
      providerLast24Hours:finite(reported.rainfallForLast24Hours) ? reported.rainfallForLast24Hours : null,
      points:rainPoints,
    } : null,
  };
}
export async function fetchGauge(siteId, options = {}) {
  if (!Object.hasOwn(STATIONS, siteId)) throw new Error('Unsupported public station');
  const hasRiver = ['229643A','229665A'].includes(siteId);
  async function get(path) {
    const response = await fetch(BASE + path,{signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
    if (!response.ok) throw new Error(`Melbourne Water HTTP ${response.status}: ${path}`);
    return response.json();
  }
  const [summary, riverLive] = await Promise.allSettled([
    get(`/${siteId}/summary`), hasRiver ? get(`/${siteId}/river-level/live`) : null,
  ]);
  if (summary.status === 'rejected' && riverLive.status === 'rejected') throw new Error(`Gauge ${siteId} unavailable`);
  return extractGauge({siteId, summary: summary.status === 'fulfilled' ? summary.value : null, riverLive: riverLive.status === 'fulfilled' ? riverLive.value : null, ...options});
}
