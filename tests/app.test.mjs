import { test } from 'node:test';
import assert from 'node:assert/strict';

test('page keeps measurements available when weather fails, and never confirms a crossing from rain', async () => {
  const NativeDate = Date;
  const now = NativeDate.parse('2026-09-07T02:30Z');
  const original = { Date, fetch, document: globalThis.document, localStorage: globalThis.localStorage, setInterval };
  const nodes = {};
  const storage = new Map();
  let requests = 0;
  class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  globalThis.Date = FixedDate;
  globalThis.document = { getElementById(id) { return nodes[id] ??= { style: {}, classList: { add() {}, remove() {} }, innerHTML: '', textContent: '', value: '', handlers: {}, addEventListener(event, handler) { this.handlers[event] = handler; } }; } };
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.setInterval = () => 0;
  let failWeather = false;
  globalThis.fetch = async url => {
    requests++;
    if (String(url).includes('api.open-meteo')) {
      if (failWeather) throw new Error('offline');
      return { ok: true, json: async () => ({ hourly: {
        time: Array.from({ length: 9 }, (_, i) => NativeDate.parse('2026-09-06T21:00Z') / 1000 + i * 3600),
        precipitation: [0, 0, 0, 0, 0, 30, 1, 2, 3],
      } }) };
    }
    return { ok: true, json: async () => ({ schemaVersion: 1, generatedAt: new NativeDate(now).toISOString(),
      gauges: [{ id: '229643A', name: 'Flemington', status: 'available', level: [{ time: '2026-09-07T02:24Z', value: 0.2 }], rainSince9am: { time: '2026-09-07T02:24Z', value: 0 } }],
      tides: { status: 'unavailable', observed: [], predicted: [] },
    }) };
  };
  try {
    const app = await import('../app.mjs');
    await app.ready;
    assert.match(nodes.rainTotals.innerHTML, /30\.0mm[\s\S]*6\.0mm/);
    assert.match(nodes.underpassList.innerHTML, /Condition unknown/);
    assert.doesNotMatch(nodes.underpassList.innerHTML, /Reported dry|Low rainfall risk/);
    assert.match(nodes.conditionsGrid.innerHTML, /0\.200/);
    const beforeSaveRequests = requests;
    nodes.reportCrossing.value = 'dynon';
    document.getElementById('reportCondition').value = 'flooded';
    document.getElementById('reportDirection').value = 'north';
    nodes.reportTime.value = '2026-09-07T12:25';
    document.getElementById('reportNote').value = '<img src=x onerror=alert(1)>';
    nodes.reportForm.handlers.submit({ preventDefault() {} });
    assert.match(nodes.underpassList.innerHTML, /Reported flooded/);
    assert.match(nodes.underpassList.innerHTML, /&lt;img/);
    assert.doesNotMatch(nodes.underpassList.innerHTML, /<img/);
    assert.equal(requests, beforeSaveRequests, 'saving a private report must not make a network request');
    const saved = [...storage.values()][0];
    assert.equal(JSON.parse(saved).length, 1);
    assert.ok(saved.length < 5000, 'report evidence stores a compact snapshot, not full measurement histories');
    failWeather = true;
    await app.loadData();
    assert.equal(nodes.rainBars.innerHTML, '');
    assert.equal(nodes.rainTotals.textContent, 'Unavailable');
    assert.match(nodes.conditionsGrid.innerHTML, /0\.200/);
    assert.equal(nodes.refreshBtn.disabled, false);
  } finally { Object.assign(globalThis, original); }
});
