/*
 * apartments.com adapter. Reads the search result cards ("placards") already
 * on the page, converts each into a shared Listing (see src/core.js), and
 * tags, fades, or hides possible rooms and coliving. Map pins whose listing
 * has had a card on the page become price and bedroom labels, colored when
 * the listing is a possible room. Other pins show rent only, from the page's
 * own search responses (see src/adapters/apartments-page.js).
 *
 * Runs in the extension's isolated world and reads settings directly from
 * chrome.storage. No requests, analytics, or page data leaves the browser.
 */
(() => {
  'use strict';
  const root = globalThis.__rentLabels;
  const core = root?.core;
  if (!core || root.apartments) return;

  // Captured from live result pages in October 2026. Older card templates
  // used the fallback price and bed selectors.
  const SELECTORS = {
    placard: 'article[data-placard], article.placard',
    link: 'a.property-link[href]',
    title: '.property-title, .js-placardTitle',
    address: '.property-address',
    optionRow: '.bedRentBox',
    optionBeds: '.bedTextBox',
    optionPrice: '.priceTextBox',
    fallbackPrice: '.property-pricing, .price-range, .property-rents',
    fallbackBeds: '.property-beds, .bed-range',
    // Google Maps advanced marker content; data-id matches the card's listing ID.
    pin: '.ap-marker[data-id]',
  };
  const MAX_TEXT = 2000;

  /** '$1,500+' -> {min: 1500, max: null}; '$1,500 - $2,100' -> {min: 1500, max: 2100}. */
  function parseRentText(text) {
    const amounts = [...String(text ?? '').matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)]
      .map(match => core.parseAmount(match[1])).filter(Boolean);
    if (!amounts.length) return null;
    return {min: Math.min(...amounts), max: amounts.length > 1 ? Math.max(...amounts) : null};
  }

  /** 'Studio' -> 0..0; '2 Beds' -> 2..2; 'Studio - 2 Beds' -> 0..2. */
  function parseBedsText(text) {
    const value = core.normalize(text);
    const counts = [];
    if (/\bstudio\b/.test(value)) counts.push(0);
    for (const match of value.matchAll(/(\d+)(?:\s*-\s*(\d+))?\s*(?:beds?|br|bd)\b/g)) {
      counts.push(Number(match[1]));
      if (match[2]) counts.push(Number(match[2]));
    }
    if (!counts.length) return null;
    return {min: Math.min(...counts), max: Math.max(...counts)};
  }

  const textOf = el => {
    if (!el) return '';
    const attribute = el.getAttribute?.('title');
    return core.normalize(attribute || el.textContent || '');
  };

  /** Read one result card into plain fields. Returns null if it is not a listing. */
  function readPlacard(el) {
    const id = el.getAttribute('data-listingid') || '';
    const link = el.querySelector(SELECTORS.link);
    const url = link?.getAttribute('href') || el.getAttribute('data-url') || '';
    if (!id && !url) return null;
    const options = [];
    for (const row of el.querySelectorAll(SELECTORS.optionRow)) {
      options.push({
        beds: parseBedsText(textOf(row.querySelector(SELECTORS.optionBeds))),
        rent: parseRentText(textOf(row.querySelector(SELECTORS.optionPrice))),
      });
    }
    if (!options.length) {
      const beds = parseBedsText(textOf(el.querySelector(SELECTORS.fallbackBeds)));
      const rent = parseRentText(textOf(el.querySelector(SELECTORS.fallbackPrice)));
      if (beds || rent) options.push({beds, rent});
    }
    return {
      id,
      url,
      title: textOf(el.querySelector(SELECTORS.title)),
      address: textOf(el.querySelector(SELECTORS.address)),
      options,
      text: core.normalize(el.textContent).slice(0, MAX_TEXT),
    };
  }

  /** Convert card fields into a Listing. Ranges keep the lowest rent. */
  function toListing(fields) {
    const rents = fields.options.map(option => option.rent?.min).filter(Boolean);
    const beds = fields.options.map(option => option.beds).filter(Boolean);
    const single = beds.length === 1 && beds[0].min === beds[0].max ? beds[0].min : null;
    const {address, unit} = core.extractAddress([fields.address, fields.title]);
    return {
      key: fields.id || fields.url,
      source: 'apartments.com',
      url: fields.url,
      title: fields.title,
      price: rents.length ? Math.min(...rents) : null,
      beds: single,
      sqft: null,
      lat: null,
      lng: null,
      photoId: '',
      thumb: '',
      address,
      unit,
      text: [fields.address, fields.text].filter(Boolean).join(' \n '),
    };
  }

  const bedText = count => count === 0 ? 'Studio' : `${count} Br`;

  /** Pin text such as '$1,550+ · Studio–1 Br'. '' when the card has no rent or beds. */
  function pinLabel(fields) {
    const rents = fields.options.map(option => option.rent).filter(Boolean);
    const beds = fields.options.map(option => option.beds).filter(Boolean);
    const parts = [];
    if (rents.length) {
      const varies = rents.length > 1 || rents.some(rent => rent.max);
      parts.push(core.formatPrice(Math.min(...rents.map(rent => rent.min))) + (varies ? '+' : ''));
    }
    if (beds.length) {
      const low = Math.min(...beds.map(range => range.min)), high = Math.max(...beds.map(range => range.max));
      parts.push(low === high ? bedText(low) : `${low === 0 ? 'Studio' : low}–${high} Br`);
    }
    return parts.join(' · ');
  }

  /** Listing ID from the card, or the last path segment of its link. */
  const listingKey = fields => fields.id || fields.url.split('/').filter(Boolean).pop() || '';

  root.apartments = Object.freeze({SELECTORS, parseRentText, parseBedsText, readPlacard, toListing, pinLabel});

  // Everything below needs a real page.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  let roomFilter = 'tag';
  let revealed = false;
  // Pin label and flag by listing ID. Kept after a card leaves the page,
  // because the results list renders only some cards while the map shows every pin.
  const seen = new Map();
  // Rent for every pin on the map, from the page hook. Used when no card has been seen.
  const pinRents = new Map();
  const rentOnly = pin => pin && {text: core.formatPrice(pin.minRent) + (pin.maxRent > pin.minRent ? '+' : ''), flag: null};
  const roomsSearch = /rooms?-for-rent|roommates?|shared-housing/i.test(location.pathname);

  /** Tag, fade or hide one card. Returns its pin label, its flag in any mode, and whether it is hidden. */
  function render(el, mode) {
    const fields = readPlacard(el);
    const found = fields ? core.classify(toListing(fields)) : null;
    const flag = mode !== 'off' ? found : null;
    const hide = !!flag && mode === 'hide' && !revealed;
    const result = fields && {key: listingKey(fields), text: pinLabel(fields), flag: found, hide};
    const state = flag ? `${mode}|${revealed}|${flag.type}|${flag.reasons.join(',')}` : 'clean';
    if (el.getAttribute('data-crl-state') === state) return result;
    el.setAttribute('data-crl-state', state);
    el.classList.remove('crl-ac-flagged', 'crl-dimmed', 'crl-hidden-placard');
    el.removeAttribute('data-crl-flag');
    if (!flag) return result;
    el.classList.add('crl-ac-flagged');
    if (mode === 'dim') el.classList.add('crl-dimmed');
    if (hide) el.classList.add('crl-hidden-placard');
    // Shown centered in the card's overlay (see styles.css).
    el.setAttribute('data-crl-flag', `${core.flagLabel(flag)}\n${flag.reasons.join(', ')}`);
    return result;
  }

  /** Replace a map pin's look with a label. Pins without a card on the page keep the native pin. */
  function renderPin(pin, entry, mode) {
    const flag = mode !== 'off' ? entry?.flag : null;
    const info = entry && {text: entry.text, flag, dim: !!flag && mode === 'dim', hide: !!flag && mode === 'hide' && !revealed};
    const state = info?.text ? `${info.text}|${flag?.type ?? ''}|${info.dim}|${info.hide}` : 'clean';
    const current = pin.querySelector('.crl-ac-pin-label');
    if (pin.getAttribute('data-crl-state') === state && !current === (state === 'clean')) return;
    pin.setAttribute('data-crl-state', state);
    current?.remove();
    if (state === 'clean') return;
    const label = document.createElement('span');
    label.className = 'crl-ac-pin-label';
    if (info.flag) {
      label.classList.add('crl-ac-pin-flagged');
      label.title = `${core.flagLabel(info.flag)} ${info.flag.reasons.join(', ')}`;
    }
    if (info.dim) label.classList.add('crl-ac-pin-dimmed');
    if (info.hide) label.classList.add('crl-ac-pin-hidden');
    label.textContent = info.text;
    pin.append(label);
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
    const mode = roomsSearch ? 'off' : roomFilter;
    let hidden = 0;
    for (const el of document.querySelectorAll(SELECTORS.placard)) {
      try {
        const result = render(el, mode);
        if (result?.hide) hidden++;
        if (result?.key) seen.set(result.key, result);
      } catch (error) { console.debug('[Rent Labels] Card format not supported', error); }
    }
    for (const pin of document.querySelectorAll(SELECTORS.pin)) {
      const id = pin.getAttribute('data-id');
      try { renderPin(pin, seen.get(id) || rentOnly(pinRents.get(id)), mode); }
      catch (error) { console.debug('[Rent Labels] Map pin format not supported', error); }
    }
    showNotice(hidden);
  }

  // Results reload in place when the map moves or filters change.
  let pending = 0;
  const schedule = () => {
    if (pending) return;
    pending = setTimeout(() => { pending = 0; scan(); }, 150);
  };
  // Ignore mutations made only by this extension, so rendering never loops.
  // data-id changes catch map pins reused for another listing; this extension never sets it.
  const ownNode = node => ['crl-ac-notice', 'crl-ac-pin-label'].some(name => node.classList?.contains(name));
  const ownMutation = mutation => mutation.type === 'childList'
    && [...mutation.addedNodes, ...mutation.removedNodes].every(ownNode);
  new MutationObserver(mutations => {
    if (!mutations.every(ownMutation)) schedule();
  }).observe(document.documentElement, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-id']});

  window.addEventListener('crl-ac-pins', event => {
    try {
      for (const pin of JSON.parse(event.detail)) {
        if (typeof pin?.listingKey === 'string' && core.parseAmount(pin.minRent)) pinRents.set(pin.listingKey, pin);
      }
    } catch { return; }
    schedule();
  });
  // The page hook may have seen search responses before this script loaded.
  window.dispatchEvent(new CustomEvent('crl-ac-pins-request'));

  const apply = value => {
    if (core.ROOM_FILTER_MODES.includes(value) && value !== roomFilter) {
      roomFilter = value;
      revealed = false;
    }
    scan();
  };
  try {
    chrome.storage.local.get({roomFilter: 'tag'}).then(saved => apply(saved.roomFilter), () => scan());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.roomFilter) apply(changes.roomFilter.newValue ?? 'tag');
    });
  } catch { scan(); }
})();
