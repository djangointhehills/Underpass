const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

async function loadPage({ now = '2026-09-07T02:30:00Z', modify, fail = false } = {}) {
  const elements = {};
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const context = vm.createContext({
    Date: Clock,
    document: { getElementById(id) {
      return elements[id] ??= { style: {}, classList: { add() {}, remove() {} }, innerHTML: '', textContent: '' };
    } },
    fetch: async (url) => {
      if (fail) throw new Error('offline');
      const unix = new URL(url).searchParams.get('timeformat') === 'unixtime';
      // 07:00–15:00 Melbourne: six completed hours total 30mm,
      // followed by three forecast hours totalling 6mm.
      const base = Date.parse('2026-09-06T21:00:00Z') / 1000;
      const data = { hourly: {
        time: Array.from({ length: 9 }, (_, i) => unix ? base + i * 3600 : `2026-09-07T${String(i + 7).padStart(2, '0')}:00`),
        precipitation: [0, 0, 0, 0, 0, 30, 1, 2, 3],
      } };
      modify?.(data);
      return { ok: true, json: async () => data };
    },
    setInterval() {},
  });
  // Await the real initial page load without starting its recurring timer.
  await vm.runInContext(script.replace(/^loadData\(\);$/m, 'var ready = loadData();') + '\nready;', context);
  return { elements, context };
}

test('latest completed hour contributes to risk, not the future forecast', async () => {
  const { elements } = await loadPage();
  assert.match(elements.rainTotals.innerHTML, /30\.0mm[\s\S]*6\.0mm/);
  assert.match(elements.underpassList.innerHTML, /High rainfall risk/);
  assert.match(elements.rainBars.innerHTML, /12p/);
  assert.match(elements.updatedAt.textContent, /12:30/);
});

test('zero rainfall is a rainfall indicator, not confirmation of a clear underpass', async () => {
  const { elements } = await loadPage({ modify: data => data.hourly.precipitation.fill(0) });
  assert.match(elements.underpassList.innerHTML, /Low rainfall risk/);
  assert.doesNotMatch(elements.underpassList.innerHTML, />Clear</);
});

test('missing rain, insufficient coverage and stale data produce unknown status', async () => {
  for (const modify of [
    data => { data.hourly.precipitation[5] = null; },
    data => { data.hourly.time = []; data.hourly.precipitation = []; },
    data => { data.hourly.time = data.hourly.time.map(t => typeof t === 'number' ? t - 86400 : t.replace('09-07', '09-06')); },
    data => { data.hourly.precipitation.pop(); },
  ]) {
    const { elements } = await loadPage({ modify });
    assert.equal(elements.errorMsg.style.display, 'block');
    assert.match(elements.underpassList.innerHTML, /Unknown/);
    assert.doesNotMatch(elements.underpassList.innerHTML, /Low rainfall risk/);
  }
});

test('failed refresh clears the old chart and success timestamp', async () => {
  const { elements, context } = await loadPage();
  context.fetch = async () => { throw new Error('offline'); };
  await vm.runInContext('loadData()', context);
  assert.equal(elements.rainBars.innerHTML, '');
  assert.equal(elements.updatedAt.textContent, '');
  assert.equal(elements.rainTotals.textContent, 'Unavailable');
  assert.match(elements.underpassList.innerHTML, /Unknown/);
  assert.equal(elements.refreshBtn.disabled, false);
});
