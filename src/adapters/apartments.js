/*
 * apartments.com adapter. Reads the search result cards ("placards") already
 * on the page, converts each into a shared Listing (see src/core.js), and
 * tags, fades, or hides possible rooms and coliving. apartments.com already
 * shows price and bedrooms, so this adapter adds no labels of its own.
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
    // Card text minus anything this extension added.
    let text = el.textContent || '';
    for (const added of el.querySelectorAll('.crl-ac-flag')) text = text.replace(added.textContent || '', ' ');
    return {
      id,
      url,
      title: textOf(el.querySelector(SELECTORS.title)),
      address: textOf(el.querySelector(SELECTORS.address)),
      options,
      text: core.normalize(text).slice(0, MAX_TEXT),
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

  root.apartments = Object.freeze({SELECTORS, parseRentText, parseBedsText, readPlacard, toListing});

  // Everything below needs a real page.
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  let roomFilter = 'tag';
  let revealed = false;
  const roomsSearch = /rooms?-for-rent|roommates?|shared-housing/i.test(location.pathname);

  function render(el, mode) {
    const fields = readPlacard(el);
    const flag = fields && mode !== 'off' ? core.classify(toListing(fields)) : null;
    const state = flag ? `${mode}|${revealed}|${flag.type}|${flag.reasons.join(',')}` : 'clean';
    if (el.getAttribute('data-crl-state') === state) return flag && mode === 'hide' && !revealed;
    el.setAttribute('data-crl-state', state);
    el.classList.remove('crl-ac-flagged', 'crl-dimmed', 'crl-hidden-placard');
    el.querySelectorAll('.crl-ac-flag').forEach(badge => badge.remove());
    if (!flag) return false;
    const hide = mode === 'hide' && !revealed;
    el.classList.add('crl-ac-flagged');
    if (mode === 'dim') el.classList.add('crl-dimmed');
    if (hide) el.classList.add('crl-hidden-placard');
    const badge = document.createElement('div');
    badge.className = 'crl-ac-flag';
    badge.textContent = `${core.flagLabel(flag)} ${flag.reasons.join(', ')}`;
    badge.title = 'Flagged by Rent Labels. Detection uses wording, so it can be wrong.';
    el.prepend(badge);
    return hide;
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
      try { if (render(el, mode)) hidden++; }
      catch (error) { console.debug('[Rent Labels] Card format not supported', error); }
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
  const ownNode = node => node.classList?.contains('crl-ac-flag') || node.classList?.contains('crl-ac-notice');
  new MutationObserver(mutations => {
    if (!mutations.every(mutation => [...mutation.addedNodes, ...mutation.removedNodes].every(ownNode))) schedule();
  }).observe(document.documentElement, {childList: true, subtree: true});

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
