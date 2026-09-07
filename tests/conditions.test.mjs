import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rainfallWindow, latestReading, levelTrend, reportStatus, validateReport, readReports, saveReport, forecastAt } from '../conditions.mjs';

const now = Date.parse('2026-09-07T02:30:00Z');
const point = (minutesAgo, value) => ({ time: new Date(now - minutesAgo * 60000).toISOString(), value });

test('rainfall includes the latest completed hour and excludes it from forecast', () => {
  const time = Array.from({ length: 9 }, (_, i) => Date.parse('2026-09-06T21:00Z') / 1000 + i * 3600);
  const hourly = { time, precipitation: [0, 0, 0, 0, 0, 30, 1, 2, 3] };
  assert.equal(rainfallWindow(hourly, now).past6, 30);
  assert.equal(rainfallWindow(hourly, now).next3, 6);
  hourly.precipitation[5] = null;
  assert.throws(() => rainfallWindow(hourly, now));
});

test('freshness uses observation time, rejecting missing, stale and future readings', () => {
  assert.equal(latestReading([point(5, 0)], now, 60).state, 'fresh');
  assert.equal(latestReading([point(61, 0.4)], now, 60).state, 'stale');
  assert.equal(latestReading([point(-30, 1)], now, 60).state, 'unavailable');
  assert.equal(latestReading([point(1, null)], now, 60).state, 'unavailable');
  assert.equal(latestReading([], now, 60).state, 'unavailable');
});

test('level trend uses an hour of readings, not a gap or a null as zero', () => {
  assert.equal(levelTrend([point(65, 0.2), point(5, 0.3)], now).direction, 'rising');
  assert.equal(levelTrend([point(5, 0.3), point(65, 0.4)], now).direction, 'falling');
  assert.equal(levelTrend([point(65, 0.3), point(5, 0.3)], now).direction, 'steady');
  assert.equal(levelTrend([point(300, 0.1), point(5, 0.3)], now), null);
});

test('old dry reports never imply current passability', () => {
  const report = { crossingId: 'dynon', condition: 'dry', observedAt: point(121, 0).time, direction: 'south' };
  assert.equal(reportStatus([report], 'dynon', now).label, 'Condition unknown');
  assert.equal(reportStatus([{ ...report, observedAt: point(10, 0).time }], 'dynon', now).label, 'Reported dry');
  assert.equal(reportStatus([{ ...report, observedAt: point(10, 0).time, condition: 'flooded' }], 'dynon', now).label, 'Reported flooded');
  assert.equal(reportStatus([], 'dynon', now).label, 'Condition unknown');
});

test('private reports reject invalid input and survive a storage round trip', () => {
  const valid = { crossingId: 'dynon', condition: 'puddled', observedAt: point(1, 0).time, direction: 'north', note: 'Water at low point' };
  assert.throws(() => validateReport({ ...valid, observedAt: point(-60, 0).time }, now));
  assert.throws(() => validateReport({ ...valid, crossingId: 'unknown-place' }, now));
  assert.throws(() => validateReport({ ...valid, condition: 'safe' }, now));
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  saveReport(storage, valid, now);
  assert.equal(readReports(storage, now)[0].note, valid.note);
  const brokenStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.throws(() => saveReport(brokenStorage, valid, now), /blocked/);
});

test('arrival forecast covers the containing hour, and missing forecasts stay unknown', () => {
  const hourly = { time: [Date.parse('2026-09-07T03:00Z') / 1000], precipitation: [2] };
  assert.equal(forecastAt(hourly, now), 2);
  assert.equal(forecastAt(hourly, now + 2 * 3600000), null);
  assert.equal(forecastAt({ ...hourly, precipitation: [null] }, now), null);
});

test('arrival exactly on an hour uses the upcoming rainfall interval', () => {
  const hourly = { time: [Date.parse('2026-09-07T03:00Z') / 1000, Date.parse('2026-09-07T04:00Z') / 1000], precipitation: [2, 4] };
  assert.equal(forecastAt(hourly, Date.parse('2026-09-07T03:00Z')), 4);
});

test('private history remains available after more than a year', () => {
  const records = [{ crossingId: 'dynon', condition: 'dry', direction: 'south', observedAt: '2024-01-01T00:00:00Z' }];
  assert.equal(readReports({ getItem: () => JSON.stringify(records) }, now).length, 1);
});
