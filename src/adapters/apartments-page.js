/*
 * apartments.com page hook. Runs in the page context so it can read the
 * listing-search responses the page already receives, and passes each map
 * pin's rent to the adapter (src/adapters/apartments.js) as a window event.
 * Search data lists every pin on the map, while result cards cover only the
 * current page.
 *
 * Makes no requests of its own and sends nothing anywhere.
 */
(() => {
  'use strict';
  if (window.__rentLabelsApartmentsHook) return;
  window.__rentLabelsApartmentsHook = true;

  const SEARCH_PATH = '/api/listing-search';
  // Every pin seen on this page, so a late-loading adapter can ask for them again.
  const pins = new Map();

  const send = () => window.dispatchEvent(new CustomEvent('crl-ac-pins', {detail: JSON.stringify([...pins.values()])}));

  function read(text) {
    let list;
    try { list = JSON.parse(text)?.map?.pins; } catch { return; }
    if (!Array.isArray(list)) return;
    for (const pin of list) {
      if (typeof pin?.listingKey !== 'string') continue;
      pins.set(pin.listingKey, {listingKey: pin.listingKey, minRent: pin.minRent, maxRent: pin.maxRent});
    }
    send();
  }

  // The first page load builds its pins into the page as window.aptsState.as.p,
  // with short keys (k, nr, xr). Later searches arrive as responses and take precedence.
  function readInitial() {
    const list = window.aptsState?.as?.p;
    if (!Array.isArray(list)) return;
    for (const pin of list) {
      if (typeof pin?.k === 'string' && !pins.has(pin.k)) pins.set(pin.k, {listingKey: pin.k, minRent: pin.nr, maxRent: pin.xr});
    }
  }

  const isSearch = url => {
    try { return new URL(String(url), location.href).pathname.startsWith(SEARCH_PATH); } catch { return false; }
  };

  const fetch0 = window.fetch;
  window.fetch = function (input) {
    const result = fetch0.apply(this, arguments);
    if (isSearch(input instanceof Request ? input.url : input)) {
      result.then(response => response.clone().text()).then(read, () => {});
    }
    return result;
  };

  const open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isSearch(url)) this.addEventListener('load', () => { try { read(this.responseText); } catch {} });
    return open0.apply(this, arguments);
  };

  window.addEventListener('crl-ac-pins-request', () => { readInitial(); send(); });
  document.addEventListener('DOMContentLoaded', () => { readInitial(); if (pins.size) send(); });
})();
