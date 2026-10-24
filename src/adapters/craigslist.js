/*
 * Craigslist adapter. Reuses the Leaflet marker data Craigslist already
 * loaded for its map, converts each search result into a shared Listing (see
 * src/core.js), and renders labels and group previews. No requests, storage,
 * or telemetry; settings arrive from settings-bridge.js.
 */
(() => {
  'use strict';
  const core = globalThis.__rentLabels?.core;
  if (!core) return;
  const VERSION = '0.7.0';
  document.documentElement?.setAttribute('data-rent-labels-build', VERSION);

  let groupClick = 'list';
  let maxRows = 3;
  let roomFilter = 'tag';
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'crl-settings') return;
    let changed = false;
    if (['list', 'zoom'].includes(event.data.groupClick)) groupClick = event.data.groupClick;
    if (Number.isInteger(event.data.maxRows) && event.data.maxRows >= 1 && event.data.maxRows <= 20) {
      changed = changed || maxRows !== event.data.maxRows;
      maxRows = event.data.maxRows;
    }
    if (core.ROOM_FILTER_MODES.includes(event.data.roomFilter)) {
      changed = changed || roomFilter !== event.data.roomFilter;
      roomFilter = event.data.roomFilter;
    }
    if (changed) active.forEach(update);
  });

  const installed = new WeakSet();
  const active = new Set();
  const markerListings = new WeakMap();
  const clickHandlers = new WeakMap();
  setInterval(() => {
    if (!document.hidden) active.forEach(update);
  }, 750);

  // On "rooms & shares" searches every result is a room, so flagging is noise.
  let lastHref = '';
  let roomsCategory = false;
  function effectiveRoomFilter() {
    if (location.href !== lastHref) {
      lastHref = location.href;
      try { roomsCategory = /\/roo(?:\/|$)/.test(new URL(lastHref).pathname); }
      catch { roomsCategory = false; }
    }
    return roomsCategory ? 'off' : roomFilter;
  }

  const toNumber = value => value == null || value === '' || !Number.isFinite(Number(value))
    ? null : Number(value);

  /** Convert one Craigslist search result into a shared Listing. */
  function toListing(result, info) {
    const location_ = result.location || {};
    // Craigslist reposts often reuse the lead image with a new title. Compare
    // image identifiers only; never download or compare photos.
    const photo = result.imageIds?.[0] || result.imageThumb;
    const photoId = typeof photo === 'string'
      ? photo.replace(/[?#].*$/, '').replace(/_[0-9]+x[0-9]+\.[a-z]+$/i, '') : '';
    const {address, unit} = core.extractAddress(
      [location_.neighborhood, location_.description, result.postingTitle]);
    return {
      key: result.pid ?? result,
      source: 'craigslist',
      url: result.url,
      title: typeof result.postingTitle === 'string' ? result.postingTitle : '',
      price: core.parseAmount(result.price),
      // Craigslist's bedrooms getter uses ||, which can discard numeric zero.
      beds: core.parseBeds(result._bedrooms ?? result.kwargs?.bedrooms ?? result.bedrooms),
      sqft: core.parseAmount(result.sqft),
      lat: toNumber(result.lat ?? info.lat),
      lng: toNumber(result.lng ?? info.lng),
      photoId,
      thumb: typeof result.imageThumb === 'string' ? result.imageThumb : '',
      address,
      unit,
      text: [location_.neighborhood, location_.description]
        .filter(value => typeof value === 'string').join(' \n '),
    };
  }

  /** Collect the listings behind a marker, which may be a cluster. */
  function collect(marker) {
    const children = typeof marker.getAllChildMarkers === 'function'
      ? marker.getAllChildMarkers() : [marker];
    const listings = [];
    for (const child of children) {
      const info = child.options?.clMarkerInfo;
      if (!info || !info.visibleCount) continue;
      const visible = info.searchResult ? [info.searchResult]
        : info.visiblePids.map(pid => info.getSearchResultByPid(pid));
      for (const result of visible) if (result) listings.push(toListing(result, info));
    }
    return core.dedupe(listings);
  }

  function update(marker) {
    try {
      const el = marker.getElement();
      if (!el) return;
      const clear = () => {
        el.classList.remove('crl-price-marker');
        el.classList.remove('crl-hidden-marker');
        el.querySelector('.crl-price-label')?.remove();
      };
      const mode = effectiveRoomFilter();
      const filtered = core.applyRoomFilter(collect(marker), mode);
      markerListings.set(marker, filtered);
      el.setAttribute('data-crl-version', VERSION);
      const entries = filtered.visible;
      if (!entries.length) {
        clear();
        // Everything here was hidden as a possible room: hide the native dot too.
        if (filtered.hidden) el.classList.add('crl-hidden-marker');
        return;
      }
      if (entries.length === 1 && !entries[0].listing.price) { clear(); return; }
      const rows = entries.slice(0, maxRows).map(({listing, flag}) => ({
        text: flag ? `${core.label(listing)} · ${core.flagLabel(flag)}` : core.label(listing),
        flag,
      }));
      if (entries.length > maxRows) rows.push({text: `+${entries.length - maxRows} more`, flag: null});
      const text = rows.map(row => row.text).join('\n');
      const content = `${mode}\n${text}`;
      if (el.querySelector('.crl-price-label')?.getAttribute('data-crl-content') === content) return;
      clear();
      const label = document.createElement('span');
      label.className = 'crl-price-label';
      label.setAttribute('data-crl-content', content);
      for (const row of rows) {
        const line = document.createElement('span');
        line.className = row.flag
          ? `crl-listing-row crl-flagged${mode === 'dim' ? ' crl-dimmed' : ''}` : 'crl-listing-row';
        if (row.flag) line.setAttribute('title', `Possible room: ${row.flag.reasons.join(', ')}`);
        line.textContent = row.text;
        line.style.setProperty('display', 'block', 'important');
        line.style.setProperty('white-space', 'nowrap', 'important');
        label.append(line);
      }
      el.append(label);
      el.classList.add('crl-price-marker');
      // The original circle remains in place, preserving its geographic anchor.
      const only = entries.length === 1 ? entries[0].listing.title : '';
      el.setAttribute('aria-label', `${text.replace(/\n/g, ', ')}${only ? ` — ${only}` : ''}`);
    } catch (error) {
      console.debug('[Rent Labels] Marker format not supported', error);
    }
  }

  function safeCraigslistURL(value) {
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' && /(^|\.)craigslist\.org$/.test(url.hostname) ? url : null;
    } catch { return null; }
  }

  function bindGroupPreview(marker, L) {
    if (typeof marker.getAllChildMarkers !== 'function') return;
    const el = marker.getElement();
    if (!el || clickHandlers.has(el)) return;
    const open = event => {
      if (groupClick === 'zoom') return;
      if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      update(marker);
      const {visible = [], hidden = 0} = markerListings.get(marker) || {};
      if (!visible.length || !marker._map) return;
      const panel = document.createElement('div');
      panel.className = 'crl-group-preview';
      const heading = document.createElement('strong');
      heading.textContent = `${visible.length} ${visible.length === 1 ? 'offer' : 'offers'}`
        + (hidden ? ` · ${hidden} possible ${hidden === 1 ? 'room' : 'rooms'} hidden` : '');
      panel.append(heading);
      const dim = effectiveRoomFilter() === 'dim';
      for (const {listing, flag} of visible) {
        const url = safeCraigslistURL(listing.url);
        if (!url) continue;
        const link = document.createElement('a');
        link.href = url.href;
        link.className = flag ? `crl-preview-item crl-flagged${dim ? ' crl-dimmed' : ''}` : 'crl-preview-item';
        const thumb = listing.thumb && safeCraigslistURL(listing.thumb);
        if (thumb) {
          const img = document.createElement('img');
          img.src = thumb.href;
          img.alt = '';
          img.loading = 'lazy';
          link.append(img);
        }
        const text = document.createElement('span');
        const details = document.createElement('strong');
        details.textContent = core.details(listing) || 'Price unavailable';
        const title = document.createElement('span');
        title.textContent = listing.title || 'View listing';
        text.append(details, title);
        if (flag) {
          const badge = document.createElement('em');
          badge.className = 'crl-flag';
          badge.textContent = `${core.flagLabel(flag)} ${flag.reasons.join(', ')}`;
          text.append(badge);
        }
        link.append(text);
        panel.append(link);
      }
      L.popup({maxWidth: 360, minWidth: 260, autoPan: false, className: 'crl-group-popup'})
        .setLatLng(marker.getLatLng()).setContent(panel).openOn(marker._map);
    };
    el.addEventListener('click', open, true);
    el.addEventListener('keydown', open, true);
    clickHandlers.set(el, open);
  }

  function install(L) {
    if (!L?.Marker?.addInitHook || installed.has(L.Marker)) return;
    installed.add(L.Marker);
    L.Marker.addInitHook(function () {
      if (!this.options?.clMarkerInfo && typeof this.getAllChildMarkers !== 'function') return;
      this.on('add', () => { active.add(this); update(this); bindGroupPreview(this, L); });
      this.on('remove', () => active.delete(this));
    });
    const original = L.Marker.prototype.setIcon;
    L.Marker.prototype.setIcon = function (...args) {
      const result = original.apply(this, args);
      update(this);
      bindGroupPreview(this, L);
      return result;
    };
  }

  // Craigslist loads Leaflet before it creates the map. Capture that assignment
  // at document_start so existing and future markers get the same behavior.
  const descriptor = Object.getOwnPropertyDescriptor(window, 'L');
  if (!descriptor || descriptor.configurable && 'value' in descriptor) {
    let value = window.L;
    install(value);
    Object.defineProperty(window, 'L', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => value,
      set(next) { value = next; install(next); }
    });
  } else {
    install(window.L);
  }
})();
