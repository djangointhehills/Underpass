export const TIME_ZONE = 'Australia/Melbourne';
export const REPORT_KEY = 'underpass-private-reports-v1';
export const CROSSINGS = [
  { id: 'racecourse', name: 'Racecourse Rd', note: 'Northern end of the creek section, near the Royal Park connection.' },
  { id: 'macaulay', name: 'Macaulay Rd', note: 'Creek crossing between Kensington and North Melbourne.' },
  { id: 'arden', name: 'Arden St', note: 'Creek crossing south of Macaulay Road.' },
  { id: 'dynon', name: 'Dynon Rd', note: 'Northern end of the lower section affected by rain, tides and drainage.' },
  { id: 'rail', name: 'Dynon–Footscray rail underpasses', note: 'Grouped rail crossings. Flooding and pump problems have been reported here.' },
  { id: 'footscray', name: 'Footscray Rd', note: 'Toward Docklands. Creek-level and elevated bridge routes have different exposure.' },
];

export function rainfallWindow(hourly, now = Date.now()) {
  const { time, precipitation } = hourly || {};
  if (!Array.isArray(time) || !Array.isArray(precipitation)) throw new Error('Missing hourly rain');
  const hour = Math.floor(now / 3600000) * 3600;
  const index = time.indexOf(hour);
  if (index < 5 || index + 3 >= time.length) throw new Error('Incomplete rainfall window');
  const bars = [];
  for (let i = index - 5; i <= index + 3; i++) {
    if (time[i] !== hour + (i - index) * 3600 || !Number.isFinite(precipitation[i]) || precipitation[i] < 0) {
      throw new Error('Missing hourly rain');
    }
    bars.push({ time: time[i], mm: precipitation[i], past: i <= index });
  }
  return {
    bars,
    past6: bars.filter(b => b.past).reduce((sum, b) => sum + b.mm, 0),
    next3: bars.filter(b => !b.past).reduce((sum, b) => sum + b.mm, 0),
  };
}

export function forecastAt(hourly, arrival) {
  const hour = (Math.floor(arrival / 3600000) + 1) * 3600;
  const index = hourly?.time?.indexOf(hour);
  const value = index >= 0 ? hourly.precipitation?.[index] : null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function validReadings(readings, now) {
  return (Array.isArray(readings) ? readings : []).filter(p =>
    p && Number.isFinite(p.value) && Number.isFinite(Date.parse(p.time)) && Date.parse(p.time) <= now
  ).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function latestReading(readings, now = Date.now(), maxAgeMinutes = 120) {
  const point = validReadings(readings, now).at(-1);
  if (!point) return { state: 'unavailable', point: null };
  const ageMinutes = (now - Date.parse(point.time)) / 60000;
  return { state: ageMinutes <= maxAgeMinutes ? 'fresh' : 'stale', point, ageMinutes };
}

export function levelTrend(readings, now = Date.now(), maxAgeMinutes = 120) {
  const latest = latestReading(readings, now, maxAgeMinutes);
  if (latest.state !== 'fresh') return null;
  const end = Date.parse(latest.point.time);
  const previous = validReadings(readings, now).filter(p => {
    const age = (end - Date.parse(p.time)) / 60000;
    return age >= 45 && age <= 90;
  }).sort((a, b) => Math.abs(end - Date.parse(a.time) - 3600000) - Math.abs(end - Date.parse(b.time) - 3600000))[0];
  if (!previous) return null;
  const delta = latest.point.value - previous.value;
  return { delta, minutes: (end - Date.parse(previous.time)) / 60000, direction: Math.abs(delta) < 0.01 ? 'steady' : delta > 0 ? 'rising' : 'falling' };
}

export function validateReport(report, now = Date.now()) {
  if (!report || !CROSSINGS.some(c => c.id === report.crossingId)) throw new Error('Choose a crossing.');
  if (!['dry', 'puddled', 'flooded'].includes(report.condition)) throw new Error('Choose a condition.');
  if (!['north', 'south'].includes(report.direction)) throw new Error('Choose a direction.');
  const time = Date.parse(report.observedAt);
  if (!Number.isFinite(time) || time > now) throw new Error('Use a valid observation time, not a future time.');
  return { ...report, observedAt: new Date(time).toISOString(), note: String(report.note || '').trim().slice(0, 280) };
}

export function readReports(storage, now = Date.now()) {
  const raw = storage.getItem(REPORT_KEY);
  if (!raw) return [];
  const reports = JSON.parse(raw);
  if (!Array.isArray(reports)) throw new Error('Saved report data could not be read.');
  return reports.flatMap(r => {
    try { return [validateReport(r, now)]; } catch { return []; }
  }).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export function saveReport(storage, report, now = Date.now()) {
  const valid = validateReport(report, now);
  const records = [valid, ...readReports(storage, now)].slice(0, 500);
  storage.setItem(REPORT_KEY, JSON.stringify(records));
  return records;
}

export function reportStatus(reports, crossingId, now = Date.now()) {
  const report = reports.filter(r => r.crossingId === crossingId && Date.parse(r.observedAt) <= now)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0] || null;
  const recent = report && now - Date.parse(report.observedAt) <= 120 * 60000;
  if (!recent) return { label: 'Condition unknown', cls: 'loading', report, recent: false };
  return { label: `Reported ${report.condition}`, cls: report.condition === 'flooded' ? 'flood' : report.condition === 'puddled' ? 'caution' : 'clear', report, recent: true };
}

export function formatTime(time, includeDate = true) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: TIME_ZONE, ...(includeDate ? { day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit',
  }).format(new Date(time));
}

export function localInputValue(time = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

// Interpret the form's wall time in Melbourne even when the browser is elsewhere.
// Refuse ambiguous or skipped DST hours instead of silently shifting an observation.
export function parseMelbourneTime(value) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return NaN;
  const nominal = Date.parse(`${value}Z`);
  const candidates = [10, 11].map(offset => nominal - offset * 3600000).filter(time => localInputValue(time) === value);
  return candidates.length === 1 ? candidates[0] : NaN;
}
