// Tests for src/adapters/zillow.js with a minimal fake page.
// Result and marker shapes follow Zillow rental searches captured in October 2026.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

// A tiny element: class list, attributes, children, and class-only selectors.
function el(tag, {id = '', classes = [], text = ''} = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), id, text, attrs: {}, classes: new Set(classes), children: [], parent: null, clicks: 0,
    classList: {
      add: (...names) => names.forEach(name => node.classes.add(name)),
      remove: (...names) => names.forEach(name => node.classes.delete(name)),
      contains: name => node.classes.has(name),
    },
    set className(value) { node.classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
    getAttribute: name => name in node.attrs ? node.attrs[name] : null,
    setAttribute: (name, value) => { node.attrs[name] = String(value); },
    removeAttribute: name => { delete node.attrs[name]; },
    get textContent() { return [node.text, ...node.children.map(child => child.textContent)].filter(Boolean).join(' '); },
    set textContent(value) { node.text = value; node.children = []; },
    append(...nodes) { for (const child of nodes) { child.parent = node; node.children.push(child); } },
    remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    querySelectorAll: selector => descendants(node).filter(child => matches(child, selector)),
    querySelector: selector => node.querySelectorAll(selector)[0] || null,
    addEventListener(type, handler) { node[`on${type}`] = handler; },
    click() { node.clicks++; },
  };
  node.append(...children);
  return node;
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
const matches = (node, selectorList) => selectorList.split(',').some(selector => {
  selector = selector.trim();
  if (selector === 'article[data-testid="property-card"]') return node.classes.has('property-card');
  if (selector === '[role="link"]') return false;
  return selector.startsWith('.') && selector.slice(1).split('.').every(name => node.classes.has(name));
});

// Fake page.
const body = el('body');
let observerCallback;
const windowListeners = {}, documentListeners = {};
const nextData = {textContent: ''};
const sandbox = vm.createContext({
  console, URL, Request: class {}, location: {href: 'https://www.zillow.com/santa-monica-ca/rentals/'},
  setTimeout: fn => { fn(); return 0; },
  MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
  XMLHttpRequest: class { open() {} addEventListener() {} },
  document: {
    body, documentElement: body, createElement: tag => el(tag),
    querySelectorAll: selector => body.querySelectorAll(selector),
    getElementById: id => id === '__NEXT_DATA__' ? nextData : null,
    addEventListener: (type, fn) => (documentListeners[type] ||= []).push(fn),
  },
});
sandbox.window = sandbox;
sandbox.addEventListener = (type, fn) => (windowListeners[type] ||= []).push(fn);
let nextResponse = '';
sandbox.fetch = async () => ({clone: () => ({text: async () => nextResponse})});
for (const file of ['src/core.js', 'src/adapters/zillow.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, {filename: file});
const zl = sandbox.__rentLabels.zillow;
const pageWindow = vm.runInContext('window', sandbox);

// Reading results.
const single = {zpid: 2098121370, statusType: 'FOR_RENT', price: '$3,000/mo', beds: 1, address: '1234 Ocean Park Blvd, Santa Monica, CA',
  hdpData: {homeInfo: {price: 3000, bedrooms: 1}}};
const building = {zpid: '34.016483--118.495926', buildingId: '34.016483--118.495926', isBuilding: true, statusType: 'FOR_RENT',
  buildingName: 'The Park Santa Monica', address: '500 Broadway, Santa Monica, CA', price: '$3,775+/mo', minBeds: 0, unitCount: 36};
const listBuilding = {...building, buildingId: 'lot-123', units: [
  {price: '$3,775+', beds: '0', roomForRent: false}, {price: '$5,261+', beds: '1', roomForRent: false}, {price: '$7,087+', beds: '2', roomForRent: false}]};
const roomBuilding = {zpid: '34.02--118.48', isBuilding: true, statusType: 'FOR_RENT', buildingName: 'Ocean House', price: '$1,400+/mo',
  units: [{price: '$1,400', beds: '1', roomForRent: true}]};

assert.equal(zl.parseRent('$3,775+/mo'), 3775);
assert.equal(zl.parseRent('Contact'), null);
const s = zl.readResult(single);
assert.equal(s.key, '2098121370');
assert.equal(zl.pinLabel(s), '$3,000 · 1 Br');
const b = zl.readResult(building);
assert.equal(b.key, '34.016483--118.495926', 'buildings are keyed by their lat--lng ID');
assert.equal(zl.pinLabel(b), '$3,775+ · Studio+', 'map results give buildings a minimum bedroom count only');
const merged = zl.merge(b, zl.readResult(listBuilding));
assert.equal(zl.readResult(listBuilding).key, b.key, 'list buildings match map buildings');
assert.equal(zl.pinLabel(merged), '$3,775+ · Studio–2 Br', 'list units add the full bedroom range');
assert.equal(zl.pinLabel(zl.merge(merged, b)), '$3,775+ · Studio–2 Br', 'later map results keep the unit range');
assert.equal(zl.readResult({...single, statusType: 'FOR_SALE'}), null, 'only rentals');
assert.equal(zl.flagFor(merged), null);
assert.deepEqual({...zl.flagFor(zl.readResult(roomBuilding))}, {type: 'room', reasons: ['Zillow lists it as a room']});
assert.equal(zl.flagFor(zl.readResult({...single, address: 'Private room in shared house'})).type, 'room');

// Markers: the ID lives on the React marker component above the pin element.
const pinFor = props => {
  const pin = el('div', {classes: ['streamlined-marker-container']}, [el('div', {classes: ['property-dot']})]);
  pin['__reactFiber$abc'] = {memoizedProps: {'data-test': 'property-marker'}, return: {memoizedProps: {markerId: 'x', ...props}}};
  return pin;
};
assert.equal(zl.markerKey(zl.markerProps(pinFor({zpid: 2098121370}))), '2098121370');
assert.equal(zl.markerKey(zl.markerProps(pinFor({zpid: null, buildingId: '34.016483--118.495926'}))), '34.016483--118.495926');
assert.equal(zl.markerProps(el('div')), null);

// Page: first-load data, then a search response.
const card = (key, text) => el('article', {id: `zpid_${key}`, classes: ['property-card'], text});
const singleCard = card('2098121370', 'Cozy 1bd near the beach');
const buildingCard = card('34.016483--118.495926', 'The Park Santa Monica $3,775+ Studio');
const roomCard = card('34.02--118.48', 'Ocean House $1,400');
const singlePin = pinFor({zpid: 2098121370});
const buildingPin = pinFor({zpid: null, buildingId: '34.016483--118.495926'});
const roomPin = pinFor({zpid: null, buildingId: '34.02--118.48'});
const unknownPin = pinFor({zpid: 1});
body.append(singleCard, buildingCard, roomCard, singlePin, buildingPin, roomPin, unknownPin);
const pinLabel = pin => pin.querySelector('.crl-zl-pin-label');

(async () => {
  nextData.textContent = JSON.stringify({props: {pageProps: {searchPageState: {cat1: {searchResults: {mapResults: [], listResults: [single, listBuilding]}}}}}});
  documentListeners.DOMContentLoaded.forEach(fn => fn());
  assert.equal(pinLabel(singlePin).textContent, '$3,000 · 1 Br', 'first-load data labels pins');
  assert.equal(pinLabel(buildingPin).textContent, '$3,775+ · Studio–2 Br');
  assert.equal(pinLabel(roomPin), null, 'pins without data keep Zillow\'s look');
  assert.equal(pinLabel(unknownPin), null);

  nextResponse = JSON.stringify({cat1: {searchResults: {mapResults: [building, roomBuilding], listResults: [roomBuilding]}}});
  await sandbox.fetch('/async-create-search-page-state', {method: 'PUT'});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pinLabel(buildingPin).textContent, '$3,775+ · Studio–2 Br', 'map results keep the list unit range');
  assert(pinLabel(roomPin).classList.contains('crl-ac-pin-flagged'), 'room pins are yellow');
  assert.equal(roomCard.getAttribute('data-crl-flag'), 'Room?\nZillow lists it as a room');
  assert.equal(buildingCard.getAttribute('data-crl-flag'), null);

  // Clicks on a label reach Zillow's own dot or pill.
  pinLabel(singlePin).onclick({stopPropagation() {}});
  assert.equal(singlePin.querySelector('.property-dot').clicks, 1);

  // Stable re-scans, filter modes and the hidden notice.
  observerCallback([{addedNodes: [el('div')], removedNodes: []}]);
  assert.equal(roomPin.querySelectorAll('.crl-zl-pin-label').length, 1);
  const settings = roomFilter => windowListeners.message.forEach(fn => fn({source: pageWindow, data: {type: 'crl-settings', roomFilter}}));
  settings('dim');
  assert(roomCard.classList.contains('crl-dimmed') && pinLabel(roomPin).classList.contains('crl-ac-pin-dimmed'));
  settings('hide');
  assert(roomCard.classList.contains('crl-hidden-placard') && pinLabel(roomPin).classList.contains('crl-ac-pin-hidden'));
  const notice = body.querySelector('.crl-ac-notice');
  assert.equal(notice.textContent, 'Rent Labels hid 1 possible room · Show');
  notice.onclick();
  assert(!roomCard.classList.contains('crl-hidden-placard') && roomCard.getAttribute('data-crl-flag'));
  settings('off');
  assert.equal(roomCard.getAttribute('data-crl-flag'), null);
  assert(!pinLabel(roomPin).classList.contains('crl-ac-pin-flagged'), 'off keeps labels without room color');

  console.log('Passed Zillow: rent parsing, single and building results, unit ranges, rentals only, room tag and wording, marker IDs, first-load and search data, pin labels, click pass-through, tag, dim, hide with notice, off.');
})().catch(error => { console.error(error); process.exit(1); });
