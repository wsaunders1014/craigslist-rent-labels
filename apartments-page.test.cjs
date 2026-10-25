// Tests for src/adapters/apartments-page.js with fake fetch and XHR.
// Response shape follows apartments.com /api/listing-search, captured October 2026.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const listeners = {}, sent = [];
const respond = body => ({clone: () => ({text: async () => body})});
let nextBody = '';
class FakeXHR {
  listeners = {};
  open() {}
  addEventListener(type, fn) { this.listeners[type] = fn; }
  finish(text) { this.responseText = text; this.listeners.load?.(); }
}
const window = {
  fetch: async () => respond(nextBody),
  addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
  dispatchEvent: event => { if (event.type === 'crl-ac-pins') sent.push(JSON.parse(event.detail)); (listeners[event.type] || []).forEach(fn => fn(event)); },
};
const documentListeners = {};
const sandbox = vm.createContext({
  window, XMLHttpRequest: FakeXHR, document: {addEventListener: (type, fn) => (documentListeners[type] ||= []).push(fn)}, URL, Request: class {}, location: {href: 'https://www.apartments.com/under-1900/'},
  CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
});
const source = fs.readFileSync(path.join(__dirname, 'src/adapters/apartments-page.js'), 'utf8');
vm.runInContext(source, sandbox, {filename: 'apartments-page.js'});
vm.runInContext(source, sandbox, {filename: 'apartments-page.js'}); // second injection is a no-op

const search = pins => JSON.stringify({results: {placardsHtml: '<section></section>'}, map: {pins}});
const flush = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // First load: pins built into the page, read once the document has loaded.
  window.aptsState = {as: {p: [{k: '9cp0475', lat: 33.99023, lng: -118.44516, t: 5, f: 152, nr: 1895, xr: 1995, mu: 1}]}};
  documentListeners.DOMContentLoaded.forEach(fn => fn());
  assert.deepEqual(sent.at(-1), [{listingKey: '9cp0475', minRent: 1895, maxRent: 1995}], 'reads initial pins from aptsState');
  sent.length = 0;

  nextBody = search([{listingKey: 'e22w91q', latitude: 34.01968, longitude: -118.40432, flags: 184, minRent: 1745, maxRent: 1795}]);
  await window.fetch('/api/listing-search', {method: 'POST'});
  await flush();
  assert.deepEqual(sent.at(-1).at(-1), {listingKey: 'e22w91q', minRent: 1745, maxRent: 1795}, 'keeps only key and rents');

  nextBody = search([{listingKey: 'x1', minRent: 900, maxRent: 900}]);
  await window.fetch('https://www.apartments.com/some/other/api');
  await flush();
  assert.equal(sent.length, 1, 'other requests are ignored');

  const xhr = new FakeXHR();
  sandbox.XMLHttpRequest.prototype.open.call(xhr, 'POST', '/api/listing-search');
  xhr.finish(search([{listingKey: '840f5v0', minRent: 893, maxRent: 2999}]));
  assert.deepEqual(sent.at(-1).map(pin => pin.listingKey), ['9cp0475', 'e22w91q', '840f5v0'], 'pins accumulate across searches');

  xhr.finish('not json');
  assert.equal(sent.length, 2, 'unreadable responses send nothing');

  // Search responses win over the older built-in data.
  xhr.finish(search([{listingKey: '9cp0475', minRent: 1850, maxRent: 1850}]));
  window.dispatchEvent(new sandbox.CustomEvent('crl-ac-pins-request'));
  assert.equal(sent.at(-1).length, 3, 'replays pins for a late adapter');
  assert.equal(sent.at(-1).find(pin => pin.listingKey === '9cp0475').minRent, 1850);

  console.log('Passed apartments.com page hook: initial aptsState pins, fetch and XHR search responses, other requests ignored, accumulation, bad JSON, replay, newer data wins.');
})().catch(error => { console.error(error); process.exit(1); });
