// Unit tests for site-independent logic in src/core.js.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'src/core.js'), 'utf8'), sandbox, {filename: 'src/core.js'});
const core = sandbox.__rentLabels.core;
const listing = fields => ({key: Math.random(), title: '', price: 1500, beds: null, sqft: null,
  lat: null, lng: null, photoId: '', address: '', unit: '', text: '', ...fields});

// Parsing and labels.
assert.equal(core.parseAmount('$2,575'), 2575);
assert.equal(core.parseAmount('unavailable'), null);
assert.equal(core.parseAmount(0), null);
assert.equal(core.parseBeds('studio'), 0);
assert.equal(core.parseBeds(' '), null);
assert.equal(core.parseBeds('2'), 2);
assert.equal(core.label(listing({beds: 0})), '$1,500 · Studio');
assert.equal(core.label(listing({title: 'Cozy studio'})), '$1,500 · Studio');
assert.equal(core.label(listing({beds: 2})), '$1,500 · 2 Br');
assert.equal(core.label(listing({price: null})), 'Price unavailable');
assert.equal(core.details(listing({beds: 1, sqft: 1200})), '$1,500 · 1 Br · 1,200 ft²');
assert.deepEqual({...core.extractAddress(['2001 Olympic Boulevard Apt 4, Santa Monica'])},
  {address: '2001 olympic blvd unit 4', unit: '4'});
assert.deepEqual({...core.extractAddress(['Santa Monica'])}, {address: '', unit: ''});

// Rooms and coliving that should be flagged.
const flagged = [
  ['Private room in 3br house, utilities included', 'room'],
  ['Furnished room for rent near UCLA', 'room'],
  ['Room available now, female roommate preferred', 'room'],
  ['$1500 bedroom in a beautiful 4 bedroom home', 'room'],
  ['Spacious room in shared apartment', 'room'],
  ['Shared kitchen, private bath, all utilities', 'room'],
  ['Looking for a housemate in Silver Lake', 'room'],
  ['Modern co-living suite in Koreatown', 'coliving'],
  ['Coliving: all-inclusive private bedrooms', 'coliving'],
  ['PadSplit room, move in today', 'coliving'],
];
for (const [title, type] of flagged) {
  const flag = core.classify(listing({title}));
  assert(flag, `should flag: ${title}`);
  assert.equal(flag.type, type, title);
  assert(flag.reasons.length > 0, title);
}
assert.equal(core.classify(listing({title: 'Cute unit', sqft: 120, beds: 0})).type, 'room');
assert.equal(core.classify(listing({title: 'Cute unit', text: 'Shared living room and kitchen'})).type, 'room');

// Whole units that should not be flagged.
const clean = [
  'Bright studio in Santa Monica',
  '1 bedroom in a quiet building, parking included',
  'Two bedroom in the heart of Echo Park',
  'Spacious 2BR with large living room',
  'Studio with shared laundry and rooftop',
  'No roommates needed! Affordable studio',
  'Charming bungalow with yard',
  'Updated 1 bedroom near studio lot',
  'Ground floor unit, dining room, bonus room',
];
for (const title of clean) assert.equal(core.classify(listing({title})), null, `should not flag: ${title}`);
assert.equal(core.classify(listing({title: 'Studio', sqft: 220, beds: 0})), null);

// Filter modes.
const whole = listing({title: 'Studio apartment'});
const room = listing({title: 'Private room for rent'});
const tagged = core.applyRoomFilter([room, whole], 'tag');
assert.deepEqual(tagged.visible.map(entry => entry.listing), [whole, room], 'flagged listings sort last');
assert.equal(tagged.visible[1].flag.type, 'room');
assert.equal(tagged.hidden, 0);
const hidden = core.applyRoomFilter([room, whole], 'hide');
assert.deepEqual(hidden.visible.map(entry => entry.listing), [whole]);
assert.equal(hidden.hidden, 1);
const off = core.applyRoomFilter([room, whole], 'off');
assert.deepEqual(off.visible.map(entry => entry.listing), [room, whole]);
assert.equal(off.visible[0].flag, null);
assert.equal(core.flagLabel({type: 'coliving'}), 'Co-living?');

console.log(`Passed core: parsing, labels, addresses, ${flagged.length} room/coliving titles, ${clean.length} whole-unit titles, filter modes.`);
