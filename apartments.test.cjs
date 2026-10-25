// Tests for src/adapters/apartments.js with a minimal fake DOM.
// Card markup follows apartments.com result placards captured in October 2026.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

// A tiny element supporting the compound selectors the adapter uses.
function el(tag, {classes = [], attrs = {}, text = ''} = {}, children = []) {
  const node = {
    tagName: tag, text, attrs: {...attrs}, classes: new Set(classes), children: [], parent: null,
    classList: {
      add: (...names) => names.forEach(name => node.classes.add(name)),
      remove: (...names) => names.forEach(name => node.classes.delete(name)),
      contains: name => node.classes.has(name),
    },
    set className(value) { node.classes = new Set(String(value).split(/\s+/).filter(Boolean)); },
    get className() { return [...node.classes].join(' '); },
    set title(value) { node.attrs.title = value; },
    getAttribute: name => name in node.attrs ? node.attrs[name] : null,
    setAttribute: (name, value) => { node.attrs[name] = String(value); },
    get textContent() { return [node.text, ...node.children.map(child => child.textContent)].filter(Boolean).join(' '); },
    set textContent(value) { node.text = value; node.children = []; },
    append(...nodes) { for (const child of nodes) { child.parent = node; node.children.push(child); } },
    prepend(child) { child.parent = node; node.children.unshift(child); },
    remove() { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    querySelectorAll(selector) { return descendants(node).filter(child => matches(child, selector)); },
    querySelector(selector) { return node.querySelectorAll(selector)[0] || null; },
    addEventListener(type, handler) { node[`on${type}`] = handler; },
  };
  node.append(...children);
  return node;
}
const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
function matches(node, selectorList) {
  return selectorList.split(',').some(selector => {
    const [, tag, classes = '', attrs = ''] = selector.trim().match(/^([a-z]+)?((?:\.[\w-]+)*)((?:\[[\w-]+\])*)$/) || [];
    if (tag && node.tagName !== tag) return false;
    if (classes.split('.').filter(Boolean).some(name => !node.classes.has(name))) return false;
    return attrs.match(/[\w-]+/g)?.every(name => name in node.attrs) ?? true;
  });
}

function placard({id, title, address, options = [], extra = ''}) {
  return el('article', {classes: ['placard'], attrs: {'data-placard': '', 'data-listingid': id}}, [
    el('a', {classes: ['property-link'], attrs: {href: `https://www.apartments.com/x/${id}/`}}),
    el('div', {classes: ['property-title', 'js-placardTitle'], attrs: {title}}),
    el('div', {classes: ['property-address', 'js-url'], attrs: {title: address}}),
    ...options.map(([beds, price]) => el('div', {classes: ['bedRentBox']}, [
      el('div', {classes: ['bedTextBox'], text: beds}),
      el('div', {classes: ['priceTextBox'], text: price}),
    ])),
    el('div', {classes: ['property-amenities'], text: extra}),
  ]);
}

// Fake page.
const body = el('body');
let observerCallback;
const storageListeners = [];
const sandbox = vm.createContext({
  console, setTimeout: (fn) => { fn(); return 1; }, location: {pathname: '/los-angeles-ca/'},
  document: {body, documentElement: body, createElement: tag => el(tag), querySelectorAll: selector => body.querySelectorAll(selector)},
  MutationObserver: class { constructor(callback) { observerCallback = callback; } observe() {} },
  chrome: {storage: {local: {get: async () => ({roomFilter: 'tag'})}, onChanged: {addListener: fn => storageListeners.push(fn)}}},
});
for (const file of ['src/core.js', 'src/adapters/apartments.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, {filename: file});
const ac = sandbox.__rentLabels.apartments;

// Parsing.
assert.deepEqual({...ac.parseRentText('$5,075+')}, {min: 5075, max: null});
assert.deepEqual({...ac.parseRentText('$1,500 - $2,100')}, {min: 1500, max: 2100});
assert.equal(ac.parseRentText('Call for Rent'), null);
assert.deepEqual({...ac.parseBedsText('Studio')}, {min: 0, max: 0});
assert.deepEqual({...ac.parseBedsText('2 Beds')}, {min: 2, max: 2});
assert.deepEqual({...ac.parseBedsText('Studio - 2 Beds')}, {min: 0, max: 2});
assert.deepEqual({...ac.parseBedsText('1 - 3 Beds')}, {min: 1, max: 3});
assert.equal(ac.parseBedsText('Contact'), null);

const studio = placard({id: 'a1', title: 'The Vermont', address: '3150 Wilshire Blvd, Los Angeles, CA 90010',
  options: [['Studio', '$1,550+'], ['1 Bed', '$1,995+']], extra: 'Laundry room in each building, fitness center'});
const fields = ac.readPlacard(studio);
assert.equal(fields.id, 'a1');
assert.equal(fields.url, 'https://www.apartments.com/x/a1/');
assert.equal(fields.title, 'the vermont');
assert.equal(fields.options.length, 2);
const listing = ac.toListing(fields);
assert.equal(listing.price, 1550, 'lowest rent across floor plans');
assert.equal(listing.beds, null, 'several floor plans means no single bedroom count');
assert.equal(listing.address, '3150 wilshire blvd');
assert.equal(sandbox.__rentLabels.core.classify(listing), null, 'amenity text is not a room signal');
assert.equal(ac.toListing(ac.readPlacard(placard({id: 'a9', title: 'X', address: '', options: [['2 Beds', '$3,000']]}))).beds, 2);

// Fallback template without bedRentBox rows.
const old = el('article', {classes: ['placard'], attrs: {'data-listingid': 'o1'}}, [
  el('div', {classes: ['property-pricing'], text: '$1,450 - $1,600'}), el('div', {classes: ['property-beds'], text: 'Studio'})]);
assert.equal(ac.toListing(ac.readPlacard(old)).price, 1450);
assert.equal(ac.readPlacard(el('article', {classes: ['placard']})), null, 'cards without an ID or link are ignored');

// Rendering on the page.
const coliving = placard({id: 'c1', title: 'Tripalink Koreatown', address: '700 S Normandie Ave, Los Angeles, CA',
  options: [['Studio - 4 Beds', '$1,150 - $1,500']], extra: 'Private bedrooms, shared kitchen'});
const perBed = placard({id: 'c2', title: 'Campus Lofts', address: 'Los Angeles, CA',
  options: [['4 Beds', '$1,200/person']]});
body.append(studio, coliving, perBed);
(async () => {
  await new Promise(resolve => setImmediate(resolve));
  const flag = node => node.querySelector('.crl-ac-flag');
  assert.equal(flag(studio), null);
  assert(flag(coliving).textContent.startsWith('Co-living? coliving operator'), flag(coliving).textContent);
  assert(flag(perBed).textContent.includes('priced per bed or person'));
  assert(coliving.classList.contains('crl-ac-flagged') && !coliving.classList.contains('crl-hidden-placard'));

  // Re-scanning is stable: one badge, and the badge text is not re-read as card text.
  observerCallback([{addedNodes: [el('div')], removedNodes: []}]);
  assert.equal(coliving.querySelectorAll('.crl-ac-flag').length, 1);

  const change = value => storageListeners.forEach(fn => fn({roomFilter: {newValue: value}}, 'local'));
  change('dim');
  assert(coliving.classList.contains('crl-dimmed'));

  change('hide');
  assert(coliving.classList.contains('crl-hidden-placard') && perBed.classList.contains('crl-hidden-placard'));
  assert(!studio.classList.contains('crl-hidden-placard'));
  const notice = body.querySelector('.crl-ac-notice');
  assert.equal(notice.textContent, 'Rent Labels hid 2 possible rooms · Show');

  notice.onclick();
  assert(!coliving.classList.contains('crl-hidden-placard'), 'Show reveals hidden cards');
  assert(coliving.querySelector('.crl-ac-flag'), 'revealed cards stay tagged');
  assert.equal(body.querySelector('.crl-ac-notice'), null);

  change('off');
  assert.equal(coliving.querySelector('.crl-ac-flag'), null);
  assert(!coliving.classList.contains('crl-ac-flagged'));

  console.log('Passed apartments.com: rent and bed parsing, floor-plan cards, fallback template, amenity text, tag, dim, hide with notice and reveal, off, stable re-scans.');
})().catch(error => { console.error(error); process.exit(1); });
