/* Reuse Craigslist's Leaflet marker data. No requests, storage, or telemetry. */
(() => {
  'use strict';
  document.documentElement?.setAttribute('data-rent-labels-build', '0.6.0');
  let groupClick = 'list';
  let maxRows = 3;
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.type !== 'crl-settings') return;
    if (['list', 'zoom'].includes(event.data.groupClick)) groupClick = event.data.groupClick;
    if (Number.isInteger(event.data.maxRows) && event.data.maxRows >= 1 && event.data.maxRows <= 20) {
      maxRows = event.data.maxRows;
      active.forEach(update);
    }
  });
  const installed = new WeakSet();
  const active = new Set();
  const listingResults = new WeakMap();
  const clickHandlers = new WeakMap();
  setInterval(() => {
    if (!document.hidden) active.forEach(update);
  }, 750);
  function update(marker) {
    try {
      const el = marker.getElement();
      if (!el) return;
      const clear = () => {
        el.classList.remove('crl-price-marker');
        el.querySelector('.crl-price-label')?.remove();
      };
      const children = typeof marker.getAllChildMarkers === 'function'
        ? marker.getAllChildMarkers() : [marker];
      const results = [];
      const offers = [];
      const seen = new Set();
      const seenUnits = new Set();
      const seenPhotos = new Set();
      const seenAddresses = new Set();
      const normalize = value => String(value ?? '').normalize('NFKC')
        .toLowerCase().replace(/\s+/g, ' ').trim();
      for (const child of children) {
        const childInfo = child.options?.clMarkerInfo;
        if (!childInfo || !childInfo.visibleCount) continue;
        const visible = childInfo.searchResult ? [childInfo.searchResult]
          : childInfo.visiblePids.map(pid => childInfo.getSearchResultByPid(pid));
        for (const result of visible) {
          if (!result || seen.has(result.pid ?? result)) continue;
          seen.add(result.pid ?? result);
          // Reposts can have different IDs. Only merge when title, location,
          // rent, bedrooms and square footage agree; price alone isn't identity.
          const title = normalize(result.postingTitle);
          const lat = result.lat ?? childInfo.lat;
          const lng = result.lng ?? childInfo.lng;
          const hasLocation = lat != null && lng != null
            && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
          let unitKey = title && hasLocation ? JSON.stringify([
            title, Number(lat).toFixed(5), Number(lng).toFixed(5),
            format(result), normalize(result.sqft)
          ]) : null;
          // Craigslist reposts often reuse the leading image with a new title.
          // Match image identifiers directly; never download or compare photos.
          const photo = result.imageIds?.[0] || result.imageThumb;
          const photoId = typeof photo === 'string'
            ? photo.replace(/[?#].*$/, '').replace(/_[0-9]+x[0-9]+\.[a-z]+$/i, '') : '';
          let photoKey = photoId && hasLocation ? JSON.stringify([
            photoId, Number(lat).toFixed(5), Number(lng).toFixed(5),
            format(result), normalize(result.sqft)
          ]) : null;
          // Search locations often contain the advertised street address.
          // Do not interpret a neighborhood name or map pin alone as an address.
          const addressSources = [result.location?.neighborhood,
            result.location?.description, result.postingTitle];
          let address = '';
          for (const source of addressSources) {
            if (typeof source !== 'string') continue;
            const match = normalize(source).match(/\b\d{1,6}\s+(?:[a-z0-9]+[ .'-]+){1,7}(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|way|terrace|ter|parkway|pkwy)\b(?:[., ]*(?:apt\.?|apartment|unit|suite|ste\.?|#)\s*[-a-z0-9]+)?/i);
            if (!match) continue;
            const abbreviations = {street:'st',avenue:'ave',boulevard:'blvd',road:'rd',drive:'dr',lane:'ln',court:'ct',place:'pl',terrace:'ter',parkway:'pkwy',north:'n',south:'s',east:'e',west:'w',apartment:'unit',apt:'unit',suite:'unit',ste:'unit'};
            address = match[0].replace(/\b[a-z]+\b/g, word => abbreviations[word] || word)
              .replace(/#/g, ' unit ').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
            break;
          }
          const addressKey = address && hasLocation ? JSON.stringify([
            address, Number(lat).toFixed(1), Number(lng).toFixed(1),
            format(result), normalize(result.sqft)
          ]) : null;
          // Explicit unit numbers must also constrain title/photo matching.
          const unit = address.match(/\bunit\s+([-a-z0-9]+)$/)?.[1] || '';
          if (unitKey) unitKey = JSON.stringify([unitKey, unit]);
          if (photoKey) photoKey = JSON.stringify([photoKey, unit]);
          // Group repeated floor-plan offers even when marketing copy and
          // photos change. Require real size/rent and a nearby building pin.
          const rent = Number(String(result.price ?? '').replace(/[$,\s]/g, ''));
          const size = Number(String(result.sqft ?? '').replace(/[,\s]/g, ''));
          const rawBeds = result._bedrooms ?? result.kwargs?.bedrooms ?? result.bedrooms;
          const beds = rawBeds == null || String(rawBeds).trim() === '' ? null
            : /^studio$/i.test(String(rawBeds)) ? 0 : Number(rawBeds);
          const offer = {lat:Number(lat), lng:Number(lng), rent, size, beds, unit, address};
          const offerMatch = hasLocation && rent > 0 && size > 0 && offers.find(previous => {
            if (previous.rent !== rent || previous.size !== size || previous.unit !== unit) return false;
            if (Number.isFinite(previous.beds) && Number.isFinite(beds) && previous.beds !== beds) return false;
            if (previous.address && address && previous.address !== address) return false;
            const north = (previous.lat - offer.lat) * 111320;
            const east = (previous.lng - offer.lng) * 111320 * Math.cos(offer.lat * Math.PI / 180);
            return Math.hypot(north, east) <= 25;
          });
          const duplicate = unitKey && seenUnits.has(unitKey)
            || photoKey && seenPhotos.has(photoKey)
            || addressKey && seenAddresses.has(addressKey)
            || offerMatch;
          if (unitKey) seenUnits.add(unitKey);
          if (photoKey) seenPhotos.add(photoKey);
          if (addressKey) seenAddresses.add(addressKey);
          if (duplicate) continue;
          if (hasLocation && rent > 0 && size > 0) offers.push(offer);
          results.push(result);
        }
      }
      listingResults.set(marker, results);
      el.setAttribute('data-crl-version', '0.6.0');
      if (!results.length) { clear(); return; }
      function format(result) {
      const raw = result?.price;
      const amount = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/[$,\s]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) return 'Price unavailable';
      const price = `$${amount.toLocaleString('en-US', {maximumFractionDigits: 0})}`;
      // Craigslist's bedrooms getter uses ||, which can discard numeric zero.
      const rawBedrooms = result._bedrooms ?? result.kwargs?.bedrooms ?? result.bedrooms;
      const bedroomsText = String(rawBedrooms ?? '').trim();
      const bedrooms = bedroomsText === '' ? NaN : Number(bedroomsText);
      const explicitStudio = /\bstudio\b/i.test(String(result.postingTitle ?? ''));
      const bedroomLabel = /^studio$/i.test(bedroomsText) || bedrooms === 0
        || (!Number.isFinite(bedrooms) && explicitStudio)
        ? 'Studio'
        : Number.isInteger(bedrooms) && bedrooms > 0 ? `${bedrooms} Br` : '';
      return bedroomLabel ? `${price} · ${bedroomLabel}` : price;
      }
      const rows = results.slice(0, maxRows).map(format);
      if (results.length === 1 && rows[0] === 'Price unavailable') { clear(); return; }
      if (results.length > maxRows) rows.push(`+${results.length - maxRows} more`);
      const text = rows.join('\n');
      if (el.querySelector('.crl-price-label')?.getAttribute('data-crl-content') === text) return;
      clear();
      const label = document.createElement('span');
      label.className = 'crl-price-label';
      label.setAttribute('data-crl-content', text);
      for (const row of rows) {
        const line = document.createElement('span');
        line.className = 'crl-listing-row';
        line.textContent = row;
        line.style.setProperty('display', 'block', 'important');
        line.style.setProperty('white-space', 'nowrap', 'important');
        label.append(line);
      }
      el.append(label);
      el.classList.add('crl-price-marker');
      // The original circle remains in place, preserving its geographic anchor.
      el.setAttribute('aria-label', `${text.replace(/\n/g, ', ')}${results.length === 1 && results[0].postingTitle ? ` — ${results[0].postingTitle}` : ''}`);
    } catch (error) {
      console.debug('[Rent Labels] Marker format not supported', error);
    }
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
      const results = listingResults.get(marker) || [];
      if (!results.length || !marker._map) return;
      const panel = document.createElement('div');
      panel.className = 'crl-group-preview';
      const heading = document.createElement('strong');
      heading.textContent = `${results.length} ${results.length === 1 ? 'offer' : 'offers'}`;
      panel.append(heading);
      for (const result of results) {
        const link = document.createElement('a');
        let url;
        try { url = new URL(result.url, location.href); } catch { continue; }
        if (url.protocol !== 'https:' || !/(^|\.)craigslist\.org$/.test(url.hostname)) continue;
        link.href = url.href;
        link.className = 'crl-preview-item';
        if (result.imageThumb) {
          try {
            const imageURL = new URL(result.imageThumb);
            if (imageURL.protocol === 'https:' && /(^|\.)craigslist\.org$/.test(imageURL.hostname)) {
              const img = document.createElement('img');
              img.src = imageURL.href;
              img.alt = '';
              img.loading = 'lazy';
              link.append(img);
            }
          } catch { /* Listings without usable thumbnails still have text. */ }
        }
        const text = document.createElement('span');
        const beds = result._bedrooms ?? result.kwargs?.bedrooms ?? result.bedrooms;
        const meta = [result.price, beds === 0 || /^studio$/i.test(String(beds)) ? 'Studio' : beds ? `${beds} Br` : '', result.sqft ? `${result.sqft} ft²` : ''].filter(Boolean).join(' · ');
        const details = document.createElement('strong');
        details.textContent = meta;
        const title = document.createElement('span');
        title.textContent = result.postingTitle || 'View listing';
        text.append(details, title);
        link.append(text);
        panel.append(link);
      }
      L.popup({maxWidth:360, minWidth:260, autoPan:false, className:'crl-group-popup'})
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
