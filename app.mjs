import { CROSSINGS, TIME_ZONE, rainfallWindow, latestReading, levelTrend, reportStatus, readReports, saveReport, formatTime, localInputValue, parseMelbourneTime, forecastAt } from './conditions.mjs';

const el = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const fixed = (value, places = 1) => Number.isFinite(value) ? value.toFixed(places) : '—';
const state = { snapshot: null, weather: null, weatherFetchedAt: null, reports: [] };
try { state.reports = readReports(localStorage); } catch { el('reportMessage').textContent = 'Saved reports could not be read. Browser storage may be unavailable.'; }

function ageText(time) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 60000));
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}
function readingTime(reading) {
  if (!reading.point) return '<p class="help-text">No usable reading.</p>';
  return `<p class="reading-time ${reading.state === 'stale' ? 'stale' : ''}">${reading.state === 'stale' ? 'Stale · ' : ''}${escape(formatTime(reading.point.time))} · ${ageText(reading.point.time)}</p>`;
}
function trendText(points, maxAge = 120) {
  const trend = levelTrend(points, Date.now(), maxAge);
  if (!trend) return 'Trend unavailable';
  return `${trend.direction[0].toUpperCase() + trend.direction.slice(1)} · ${trend.delta > 0 ? '+' : ''}${fixed(trend.delta, 3)} m over ${Math.round(trend.minutes)} min`;
}

function renderMeasurements() {
  const snapshot = state.snapshot;
  const generatedAt = Date.parse(snapshot?.generatedAt);
  el('sourceUpdated').textContent = Number.isFinite(generatedAt)
    ? `Sources checked ${formatTime(generatedAt)} · ${ageText(snapshot.generatedAt)}. Scheduled checks about every 30 minutes; delays are possible.`
    : 'Measurements unavailable. Use the source links below; refresh to try again.';
  const cards = ['229643A', '229665A'].map(id => {
    const gauge = snapshot?.gauges?.find(g => g.id === id);
    const name = id === '229643A' ? 'Flemington creek gauge' : 'Broadmeadows / Jacana gauge';
    const reading = latestReading(gauge?.level, Date.now(), 120);
    const rain = latestReading(gauge?.rainSince9am ? [gauge.rainSince9am] : [], Date.now(), 120);
    return `<article class="measurement"><h3>${name}</h3>
      <div class="value">${reading.point ? `${fixed(reading.point.value, 3)} m` : 'Unavailable'}</div>
      <p class="help-text">${escape(trendText(gauge?.level))}</p>${readingTime(reading)}
      <p>${rain.point ? `${fixed(rain.point.value)} mm measured since 9 am` : 'Measured rainfall unavailable'}</p>
      ${rain.point ? readingTime(rain) : ''}
      ${gauge?.warning ? `<p class="stale">${escape(gauge.warning)}</p>` : ''}</article>`;
  });
  const tides = snapshot?.tides;
  const observed = latestReading(tides?.observed, Date.now(), 90);
  const residual = latestReading(tides?.residual ? [tides.residual] : [], Date.now(), 90);
  cards.push(`<article class="measurement"><h3>Breakwater Pier · observed tide</h3>
    <div class="value">${observed.point ? `${fixed(observed.point.value, 3)} m` : 'Unavailable'}</div>
    <p class="help-text">${escape(trendText(tides?.observed, 90))}</p>${readingTime(observed)}
    <p class="help-text">Downstream proxy; provider height datum unspecified.</p></article>`);
  cards.push(`<article class="measurement"><h3>Weather-driven tide difference</h3>
    <div class="value">${residual.point ? `${residual.point.value >= 0 ? '+' : ''}${fixed(residual.point.value, 3)} m` : 'Unavailable'}</div>
    <p class="help-text">Observed minus astronomical prediction, from the provider.</p>${readingTime(residual)}
    <p class="help-text">Positive means above the predicted tide; this is not depth on the path.</p></article>`);
  el('conditionsGrid').innerHTML = cards.join('');
}

function renderCrossings() {
  el('underpassList').innerHTML = CROSSINGS.map(crossing => {
    const status = reportStatus(state.reports, crossing.id);
    const report = status.report;
    return `<article class="underpass-card ${status.cls}">
      <div class="status-icon" aria-hidden="true">${status.cls === 'flood' ? '⚠' : status.cls === 'clear' ? '•' : '?'}</div>
      <div class="underpass-info"><h3 class="underpass-name">${crossing.name}</h3><p class="underpass-note">${crossing.note}</p>
        <p class="report-detail">${report ? `Your last report: ${escape(report.condition)} · ${escape(formatTime(report.observedAt))} · ${ageText(report.observedAt)} · ${report.direction === 'south' ? 'southbound' : 'northbound'}.${status.recent ? ' Conditions may have changed.' : ' Too old to describe current conditions.'}` : 'No observation saved on this device.'}</p>
        ${report?.note ? `<p class="report-detail">${escape(report.note)}</p>` : ''}
        <button class="report-link" data-crossing="${crossing.id}">Record conditions</button></div>
      <div class="status-badge">${status.label}</div></article>`;
  }).join('');
}

function renderOutlook() {
  const target = parseMelbourneTime(el('arrivalTime').value);
  const now = Date.now();
  if (!Number.isFinite(target) || target < now - 60000 || target > now + 24 * 3600000) {
    el('outlook').textContent = 'Choose a Melbourne time between now and 24 hours ahead. Ambiguous daylight-saving times are not accepted.';
    return;
  }
  const weatherFresh = state.weatherFetchedAt && now - state.weatherFetchedAt <= 60 * 60000;
  const rain = weatherFresh ? forecastAt(state.weather?.hourly, target) : null;
  const prediction = state.snapshot?.tides?.predicted?.filter(p => Number.isFinite(p.value) && Math.abs(Date.parse(p.time) - target) <= 5 * 60000)
    .sort((a, b) => Math.abs(Date.parse(a.time) - target) - Math.abs(Date.parse(b.time) - target))[0];
  const points = [rain === null ? 'Rain forecast unavailable for that hour.' : `${fixed(rain)} mm modelled rain in the hour containing your crossing time.`];
  points.push(prediction ? `Williamstown astronomical tide near arrival: ${fixed(prediction.value, 3)} m at ${formatTime(prediction.time, false)}. Wind and pressure can change the actual level.` : 'Tide prediction unavailable for that time.');
  for (const gauge of state.snapshot?.gauges || []) {
    const trend = levelTrend(gauge.level, now);
    if (trend) points.push(`${gauge.name}: creek currently ${trend.direction}; ${trend.delta > 0 ? '+' : ''}${fixed(trend.delta, 3)} m over ${Math.round(trend.minutes)} min. This is an observed trend, not a future level prediction.`);
  }
  const flooded = CROSSINGS.filter(c => reportStatus(state.reports, c.id, now).label === 'Reported flooded');
  el('outlook').innerHTML = `<p class="help-text"><strong>${flooded.length ? 'Recent flooded report — check an alternative route.' : 'Passability forecast: unconfirmed.'}</strong></p>
    <ul>${points.map(p => `<li>${escape(p)}</li>`).join('')}</ul>
    <p class="help-text">Evidence: ${state.reports.some(r => now - Date.parse(r.observedAt) <= 120 * 60000) ? 'recent personal report for part of the route' : 'no recent personal observations'}. Pump operation and closures remain unverified.</p>`;
}

function renderRain() {
  if (!state.weather) {
    el('rainBars').innerHTML = '';
    el('rainTotals').textContent = 'Unavailable';
    el('updatedAt').textContent = '';
    el('errorMsg').style.display = 'block';
    return;
  }
  try {
    const rain = rainfallWindow(state.weather.hourly);
    const max = Math.max(...rain.bars.map(b => b.mm), 1);
    el('rainBars').innerHTML = rain.bars.map(b => {
      const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date(b.time * 1000)));
      const label = `${hour % 12 || 12}${hour < 12 ? 'a' : 'p'}`;
      return `<div class="bar-wrap"><div class="bar ${b.past ? 'past' : 'future'}" style="height:${Math.max(b.mm / max * 100, 3)}%" title="${fixed(b.mm)}mm"></div><div class="bar-label">${label}</div></div>`;
    }).join('');
    el('rainTotals').innerHTML = `Last 6 completed hours: <strong>${fixed(rain.past6)}mm</strong> · Following 3h forecast: <strong>${fixed(rain.next3)}mm</strong>`;
    el('updatedAt').textContent = `Weather fetched ${formatTime(state.weatherFetchedAt)} · Melbourne time`;
    el('errorMsg').style.display = 'none';
  } catch { state.weather = null; renderRain(); }
}

async function getJSON(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Source unavailable');
  return response.json();
}
export async function loadData() {
  if (el('refreshBtn').disabled) return;
  el('refreshBtn').disabled = true;
  el('refreshBtn').classList.add('spinning');
  try {
    const [measurements, weather] = await Promise.allSettled([
      getJSON('./data/conditions.json'),
      getJSON('https://api.open-meteo.com/v1/forecast?latitude=-37.74&longitude=144.91&hourly=precipitation&timezone=Australia%2FMelbourne&timeformat=unixtime&forecast_days=2&past_days=1'),
    ]);
    state.snapshot = measurements.status === 'fulfilled' && measurements.value.schemaVersion === 1 ? measurements.value : null;
    state.weather = weather.status === 'fulfilled' ? weather.value : null;
    state.weatherFetchedAt = state.weather ? Date.now() : null;
    renderMeasurements(); renderRain(); renderCrossings(); renderOutlook();
  } finally { el('refreshBtn').disabled = false; el('refreshBtn').classList.remove('spinning'); }
}

el('arrivalTime').value = localInputValue(Date.now() + 30 * 60000);
el('reportTime').value = localInputValue();
el('reportCrossing').innerHTML = CROSSINGS.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
el('refreshBtn').addEventListener('click', loadData);
el('arrivalTime').addEventListener('change', renderOutlook);
el('underpassList').addEventListener('click', event => {
  const button = event.target.closest('[data-crossing]');
  if (!button) return;
  el('reportCrossing').value = button.dataset.crossing;
  el('reportTime').value = localInputValue();
  el('reportBox').open = true;
  el('reportBox').scrollIntoView({ block: 'center' });
  el('reportCondition').focus();
});
el('reportForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const observed = parseMelbourneTime(el('reportTime').value);
    if (!Number.isFinite(observed)) throw new Error('Choose a valid, unambiguous Melbourne observation time.');
    const capturedAt = new Date().toISOString();
    let modelRain = null;
    try { const { past6, next3 } = rainfallWindow(state.weather?.hourly); modelRain = { fetchedAt: state.weatherFetchedAt, past6, next3 }; } catch { /* Missing weather stays missing. */ }
    const evidenceAtSave = {
      capturedAt, publicDataCheckedAt: state.snapshot?.generatedAt || null, modelRain,
      gauges: (state.snapshot?.gauges || []).map(g => ({ id: g.id, level: latestReading(g.level).point, rainSince9am: g.rainSince9am, trend: levelTrend(g.level) })),
      tide: latestReading(state.snapshot?.tides?.observed).point,
      tideResidual: state.snapshot?.tides?.residual || null,
    };
    state.reports = saveReport(localStorage, {
      crossingId: el('reportCrossing').value, condition: el('reportCondition').value,
      direction: el('reportDirection').value, observedAt: new Date(observed).toISOString(), note: el('reportNote').value,
      capturedAt,
      // This snapshot was read when SAVING, not necessarily at the observation time.
      evidenceAtSave,
    });
    el('reportMessage').textContent = 'Saved on this device only. Latest 500 reports are kept; export to preserve a copy.';
    el('reportNote').value = '';
    renderCrossings(); renderOutlook();
  } catch (error) { el('reportMessage').textContent = `Not saved: ${error.message}`; }
});
el('exportReports').addEventListener('click', () => {
  try {
    const reports = readReports(localStorage);
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), reports }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'private-underpass-reports.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    el('reportMessage').textContent = 'Private history exported. Keep this file private if it contains your travel times.';
  } catch (error) { el('reportMessage').textContent = `Export failed: ${error.message}`; }
});

renderCrossings();
export const ready = loadData();
setInterval(loadData, 30 * 60000);
setInterval(() => { renderMeasurements(); renderCrossings(); renderOutlook(); }, 60000);
