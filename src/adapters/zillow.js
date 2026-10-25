/*
 * Zillow adapter. Runs in the page context to read Zillow's own search data:
 * the results built into the first page load (__NEXT_DATA__), then the
 * async-create-search-page-state responses the page requests as the map
 * moves. Labels map pins with rent and bedrooms, and tints result cards and
 * pins that look like rooms or coliving.
 *
 * Pins carry no listing ID in their markup, so the ID is read from the React
 * props of each pin's marker component. Zillow can change that at any time;
 * pins that cannot be identified keep Zillow's own look.
 *
 * No requests, analytics, or storage; settings arrive from settings-bridge.js.
 */
(() => {
  'use strict';
  const root = globalThis.__rentLabels;
  const core = root?.core;
  if (!core || root.zillow) return;

  // Captured from live rental searches in October 2026.
  const SEARCH_PATH = '/async-create-search-page-state';
  const SELECTORS = {
    card: 'article[data-testid="property-card"]',
    pin: '.streamlined-marker-container',
    // Zillow's own clickable dot or pill inside a pin.
    pinTarget: '[role="link"], .property-pill, .property-dot',
  };
  const MAX_TEXT = 2000;

  /** '$3,775+/mo' -> 3775. */
  const parseRent = text => core.parseAmount(String(text ?? '').match(/\$\s*([\d,]+)/)?.[1]);

  /** Single listings are keyed by zpid; buildings by their 'lat--lng' building ID. */
  function resultKey(result) {
    if (!result.isBuilding) return result.zpid == null ? '' : String(result.zpid);
    return [result.buildingId, result.zpid].map(String).find(id => id.includes('--')) || '';
  }

  /** Read one search result (map or list) into the fields this adapter uses. */
  function readResult(result) {
    if (!result || typeof result !== 'object') return null;
    if (result.statusType && result.statusType !== 'FOR_RENT') return null;
    const key = resultKey(result);
    if (!key) return null;
    const home = result.hdpData?.homeInfo || {};
    const units = Array.isArray(result.units)
      ? result.units.map(unit => ({rent: parseRent(unit.price), beds: core.parseBeds(unit.beds), room: unit.roomForRent === true}))
      : null;
    const rents = units ? units.map(unit => unit.rent).filter(Boolean) : [];
    const beds = units ? units.map(unit => unit.beds).filter(count => count != null) : [];
    const listed = units ? null : core.parseBeds(result.isBuilding ? result.minBeds : (result.beds ?? home.bedrooms));
    return {
      key,
      building: !!result.isBuilding,
      price: rents.length ? Math.min(...rents) : core.parseAmount(home.price) || parseRent(result.price),
      varies: !!result.isBuilding || rents.length > 1 || /\+/.test(result.price || ''),
      bedsMin: beds.length ? Math.min(...beds) : listed,
      // Map results give buildings a minimum only.
      bedsMax: beds.length ? Math.max(...beds) : (result.isBuilding ? null : listed),
      roomUnits: units ? units.filter(unit => unit.room).length : null,
      text: [result.buildingName, result.statusText, result.address].filter(Boolean).join(' \n '),
    };
  }

  /** Newer fields win, but missing ones never erase what a richer result provided. */
  function merge(old, next) {
    const out = {...old};
    for (const [field, value] of Object.entries(next)) if (value != null && value !== '') out[field] = value;
    return out;
  }

  const bedText = count => count === 0 ? 'Studio' : `${count} Br`;

  /** Pin text such as '$3,775+ · Studio–2 Br'. */
  function pinLabel(info) {
    const parts = [];
    if (info.price) parts.push(core.formatPrice(info.price) + (info.varies ? '+' : ''));
    if (info.bedsMin != null) {
      if (info.bedsMax == null && info.building) parts.push(`${bedText(info.bedsMin)}+`);
      else if (info.bedsMax == null || info.bedsMax === info.bedsMin) parts.push(bedText(info.bedsMin));
      else parts.push(`${info.bedsMin === 0 ? 'Studio' : info.bedsMin}–${info.bedsMax} Br`);
    }
    return parts.join(' · ');
  }

  /** Zillow's own room tag first, then the shared wording checks. */
  function flagFor(info, cardText = '') {
    const found = core.classify({title: '', text: [info?.text, cardText].filter(Boolean).join(' \n ')});
    if (!info?.roomUnits) return found;
    const reason = 'Zillow lists it as a room';
    return found ? {type: found.type, reasons: [reason, ...found.reasons]} : {type: 'room', reasons: [reason]};
  }

  /** The props of the React marker component that rendered this pin, or null. */
  function markerProps(el) {
    const fiberKey = Object.keys(el).find(name => name.startsWith('__reactFiber'));
    for (let fiber = fiberKey && el[fiberKey], depth = 0; fiber && depth < 6; fiber = fiber.return, depth++) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object' && 'markerId' in props) return props;
    }
    return null;
  }
  const markerKey = props => props ? String(props.buildingId || props.zpid || '') : '';

  root.zillow = Object.freeze({SELECTORS, parseRent, readResult, merge, pinLabel, flagFor, markerProps, markerKey});

  // Everything below needs a real page.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  /** Listing fields by key, from every search response seen on this page. */
  const listings = new Map();
  // Card text by listing key, kept so a pin is flagged the same way as its card.
  const cardTexts = new Map();
  let roomFilter = 'tag';
  let revealed = false;

  function readSearch(state) {
    const results = state?.cat1?.searchResults;
    if (!results) return;
    // List results last: they carry per-unit beds and room tags that map results lack.
    for (const list of [results.mapResults, results.relaxedMapResults, results.listResults, results.relaxedResults]) {
      if (!Array.isArray(list)) continue;
      for (const result of list) {
        const info = readResult(result);
        if (info) listings.set(info.key, listings.has(info.key) ? merge(listings.get(info.key), info) : info);
      }
    }
    schedule();
  }

  function readInitial() {
    try { readSearch(JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || 'null')?.props?.pageProps?.searchPageState); }
    catch { /* page without search data */ }
  }

  const isSearch = url => {
    try { return new URL(String(url), location.href).pathname.startsWith(SEARCH_PATH); } catch { return false; }
  };
  const readText = text => { try { readSearch(JSON.parse(text)); } catch { /* not a search response */ } };

  const fetch0 = window.fetch;
  window.fetch = function (input) {
    const result = fetch0.apply(this, arguments);
    if (isSearch(input instanceof Request ? input.url : input)) {
      result.then(response => response.clone().text()).then(readText, () => {});
    }
    return result;
  };
  const open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isSearch(url)) this.addEventListener('load', () => { try { readText(this.responseText); } catch {} });
    return open0.apply(this, arguments);
  };

  /** Tint, fade or hide one result card. Returns true when it is hidden. */
  function renderCard(el, mode) {
    const key = el.id.replace(/^zpid_/, '');
    const info = listings.get(key);
    if (info) cardTexts.set(key, core.normalize(el.textContent).slice(0, MAX_TEXT));
    const flag = info && mode !== 'off' ? flagFor(info, cardTexts.get(key)) : null;
    const hide = !!flag && mode === 'hide' && !revealed;
    const state = flag ? `${mode}|${revealed}|${flag.type}|${flag.reasons.join(',')}` : 'clean';
    if (el.getAttribute('data-crl-state') === state) return hide;
    el.setAttribute('data-crl-state', state);
    el.classList.remove('crl-ac-flagged', 'crl-dimmed', 'crl-hidden-placard');
    el.removeAttribute('data-crl-flag');
    if (!flag) return false;
    el.classList.add('crl-ac-flagged');
    if (mode === 'dim') el.classList.add('crl-dimmed');
    if (hide) el.classList.add('crl-hidden-placard');
    // Shown centered in the card's overlay (see styles.css).
    el.setAttribute('data-crl-flag', `${core.flagLabel(flag)}\n${flag.reasons.join(', ')}`);
    return hide;
  }

  /** Replace a pin's look with a label. Pins that cannot be identified keep Zillow's own look. */
  function renderPin(el, mode) {
    const key = markerKey(markerProps(el));
    const info = listings.get(key);
    const text = info ? pinLabel(info) : '';
    const flag = text && mode !== 'off' ? flagFor(info, cardTexts.get(key)) : null;
    const dim = !!flag && mode === 'dim', hide = !!flag && mode === 'hide' && !revealed;
    const state = text ? `${text}|${flag?.type ?? ''}|${dim}|${hide}` : 'clean';
    const current = el.querySelector('.crl-zl-pin-label');
    if (el.getAttribute('data-crl-state') === state && !current === (state === 'clean')) return;
    el.setAttribute('data-crl-state', state);
    current?.remove();
    if (state === 'clean') return;
    const label = document.createElement('span');
    label.className = 'crl-ac-pin-label crl-zl-pin-label';
    if (flag) {
      label.classList.add('crl-ac-pin-flagged');
      label.title = `${core.flagLabel(flag)} ${flag.reasons.join(', ')}`;
    }
    if (dim) label.classList.add('crl-ac-pin-dimmed');
    if (hide) label.classList.add('crl-ac-pin-hidden');
    label.textContent = text;
    // Zillow's own dot or pill is hidden under the label, so pass clicks on to it.
    label.addEventListener('click', event => {
      event.stopPropagation();
      el.querySelector(SELECTORS.pinTarget)?.click();
    });
    el.append(label);
  }

  let notice;
  function showNotice(hiddenCount) {
    if (!hiddenCount) { notice?.remove(); notice = null; return; }
    if (!notice) {
      notice = document.createElement('button');
      notice.type = 'button';
      notice.className = 'crl-ac-notice';
      notice.addEventListener('click', () => { revealed = true; scan(); });
      document.body.append(notice);
    }
    notice.textContent = `Rent Labels hid ${hiddenCount} possible ${hiddenCount === 1 ? 'room' : 'rooms'} · Show`;
  }

  function scan() {
    if (!listings.size) readInitial();
    let hidden = 0;
    for (const el of document.querySelectorAll(SELECTORS.card)) {
      try { if (renderCard(el, roomFilter)) hidden++; }
      catch (error) { console.debug('[Rent Labels] Zillow card format not supported', error); }
    }
    for (const el of document.querySelectorAll(SELECTORS.pin)) {
      try { renderPin(el, roomFilter); }
      catch (error) { console.debug('[Rent Labels] Zillow map pin format not supported', error); }
    }
    showNotice(hidden);
  }

  // Results and pins re-render in place as the map moves.
  let pending = 0;
  function schedule() {
    if (pending) return;
    pending = setTimeout(() => { pending = 0; scan(); }, 150);
  }
  // Ignore mutations made only by this extension, so rendering never loops.
  const ownNode = node => ['crl-ac-notice', 'crl-zl-pin-label'].some(name => node.classList?.contains(name));
  new MutationObserver(mutations => {
    if (!mutations.every(mutation => [...mutation.addedNodes, ...mutation.removedNodes].every(ownNode))) schedule();
  }).observe(document.documentElement, {childList: true, subtree: true});

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'crl-settings') return;
    if (!core.ROOM_FILTER_MODES.includes(event.data.roomFilter) || event.data.roomFilter === roomFilter) return;
    roomFilter = event.data.roomFilter;
    revealed = false;
    scan();
  });
  document.addEventListener('DOMContentLoaded', () => { readInitial(); scan(); });
})();
