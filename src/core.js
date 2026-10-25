/*
 * Site-independent listing logic shared by every adapter.
 *
 * Adapters read listings from a rental site and convert each one into a
 * plain Listing object. Everything here works only on that shape, so a new
 * site needs a new adapter, not changes to labels, dedupe, or filters.
 *
 * Listing {
 *   key      unique per site (listing ID, or the raw object as a fallback)
 *   source   'craigslist', ...
 *   url      link to the full listing
 *   title    posting title ('' if unknown)
 *   price    monthly rent as a number, or null
 *   beds     bedrooms as a number (0 = studio), or null if unknown
 *   sqft     square footage as a number, or null
 *   lat, lng numbers, or null
 *   photoId  stable identifier of the lead photo ('' if unknown)
 *   thumb    thumbnail URL ('' if unknown)
 *   address  normalized street address ('' if none found)
 *   unit     normalized unit number ('' if none found)
 *   text     any searchable text (title, location, description snippet)
 * }
 *
 * Runs in the page context. No requests, analytics, or storage.
 */
(() => {
  'use strict';
  const root = globalThis.__rentLabels = globalThis.__rentLabels || {};
  if (root.core) return;

  const normalize = value => String(value ?? '').normalize('NFKC')
    .toLowerCase().replace(/\s+/g, ' ').trim();

  /** Parse '$2,575', 2575 or '2575' into a positive number, else null. */
  function parseAmount(raw) {
    const amount = typeof raw === 'number' ? raw
      : Number(String(raw ?? '').replace(/[$,\s]/g, ''));
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  /** Parse a bedroom value. 'studio' and 0 become 0; blank or invalid is null. */
  function parseBeds(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return null;
    if (/^studio$/i.test(text)) return 0;
    const beds = Number(text);
    return Number.isFinite(beds) && beds >= 0 ? beds : null;
  }

  function formatPrice(price) {
    return price ? `$${price.toLocaleString('en-US', {maximumFractionDigits: 0})}` : '';
  }

  function bedroomLabel(listing) {
    if (listing.beds === 0) return 'Studio';
    if (listing.beds == null && /\bstudio\b/i.test(listing.title || '')) return 'Studio';
    return Number.isInteger(listing.beds) && listing.beds > 0 ? `${listing.beds} Br` : '';
  }

  /**
   * Map label text such as '$2,000 · Studio'. When the search is limited to
   * one bedroom count (fixedBeds), repeating it on every marker is noise, so
   * bedrooms appear only for listings that differ from it.
   */
  function label(listing, {fixedBeds = null} = {}) {
    if (!listing.price) return 'Price unavailable';
    const redundant = fixedBeds != null && (listing.beds == null || listing.beds === fixedBeds);
    const beds = redundant ? '' : bedroomLabel(listing);
    return beds ? `${formatPrice(listing.price)} · ${beds}` : formatPrice(listing.price);
  }

  /** Longer detail line for previews: price, bedrooms and size. */
  function details(listing) {
    return [formatPrice(listing.price), bedroomLabel(listing),
      listing.sqft ? `${listing.sqft.toLocaleString('en-US')} ft²` : '']
      .filter(Boolean).join(' · ');
  }

  const STREET = /\b\d{1,6}\s+(?:[a-z0-9]+[ .'-]+){1,7}(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|place|pl|way|terrace|ter|parkway|pkwy)\b(?:[., ]*(?:apt\.?|apartment|unit|suite|ste\.?|#)\s*[-a-z0-9]+)?/i;
  const ABBREVIATIONS = {street:'st', avenue:'ave', boulevard:'blvd', road:'rd', drive:'dr',
    lane:'ln', court:'ct', place:'pl', terrace:'ter', parkway:'pkwy', north:'n', south:'s',
    east:'e', west:'w', apartment:'unit', apt:'unit', suite:'unit', ste:'unit'};

  /**
   * Find the first street address in the given strings. A neighborhood name or
   * map pin alone is never treated as an address.
   */
  function extractAddress(sources) {
    for (const source of sources) {
      if (typeof source !== 'string') continue;
      const match = normalize(source).match(STREET);
      if (!match) continue;
      const address = match[0].replace(/\b[a-z]+\b/g, word => ABBREVIATIONS[word] || word)
        .replace(/#/g, ' unit ').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
      return {address, unit: address.match(/\bunit\s+([-a-z0-9]+)$/)?.[1] || ''};
    }
    return {address: '', unit: ''};
  }

  const hasLocation = listing => listing.lat != null && listing.lng != null
    && Number.isFinite(listing.lat) && Number.isFinite(listing.lng);

  /**
   * Drop listings that are likely the same offer posted more than once.
   * Reposts can have different IDs, titles and photos, so several rules each
   * require rent, bedrooms and size to agree; price alone is never identity.
   */
  function dedupe(listings) {
    const unique = [];
    const offers = [];
    const seen = new Set();
    const seenUnits = new Set();
    const seenPhotos = new Set();
    const seenAddresses = new Set();
    for (const listing of listings) {
      if (!listing || seen.has(listing.key)) continue;
      seen.add(listing.key);
      const located = hasLocation(listing);
      const lat5 = located ? listing.lat.toFixed(5) : '';
      const lng5 = located ? listing.lng.toFixed(5) : '';
      const text = label(listing);
      const size = listing.sqft ?? '';
      const title = normalize(listing.title);
      // Explicit unit numbers constrain every rule below.
      const unitKey = title && located
        ? JSON.stringify([title, lat5, lng5, text, size, listing.unit]) : null;
      const photoKey = listing.photoId && located
        ? JSON.stringify([listing.photoId, lat5, lng5, text, size, listing.unit]) : null;
      const addressKey = listing.address && located ? JSON.stringify([listing.address,
        listing.lat.toFixed(1), listing.lng.toFixed(1), text, size]) : null;
      // Repeated floor-plan offers: same rent and size within 25 metres.
      const comparable = located && listing.price && listing.sqft;
      const offerMatch = comparable && offers.find(previous => {
        if (previous.price !== listing.price || previous.sqft !== listing.sqft
          || previous.unit !== listing.unit) return false;
        if (Number.isFinite(previous.beds) && Number.isFinite(listing.beds)
          && previous.beds !== listing.beds) return false;
        if (previous.address && listing.address && previous.address !== listing.address) return false;
        const north = (previous.lat - listing.lat) * 111320;
        const east = (previous.lng - listing.lng) * 111320 * Math.cos(listing.lat * Math.PI / 180);
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
      if (comparable) offers.push(listing);
      unique.push(listing);
    }
    return unique;
  }

  /*
   * Room and coliving detection. Sites mix single rooms into whole-unit
   * results, and coliving operators list each bedroom as its own "unit".
   * These are text signals, not verified facts, so the UI says "possible".
   */
  const COLIVING_PATTERNS = [
    [/\bco[- ]?living\b/, 'mentions coliving'],
    [/\bco[- ]?live\b/, 'mentions coliving'],
    [/\b(?:padsplit|tripalink)\b/, 'coliving operator'],
  ];
  const ROOM_PATTERNS = [
    [/\b(?:private|furnished|shared|single|spare)\s+(?:bed)?rooms?\b(?!\s+(?:apartment|apt|unit|home|house|condo))/, 'private or shared room'],
    [/\brooms?\s+(?:for\s+rent|available|for\s+lease)\b/, 'room for rent'],
    // "Room in a 3br house", but not "1 bedroom in a quiet building" or
    // amenity phrases like "laundry room in each apartment".
    [/(?<!(?:^|[^$\d,.])(?:[1-6]|one|two|three|four|five|six)[\s-]*)(?<!\b(?:laundry|living|dining|family|great|game|media|fitness|club|community|mail|package|storage|study|bonus|rec|utility|powder)\s)\b(?:bed)?room\s+in\s+(?:a|an|my|our|the|shared|large|big)?\s*(?:[a-z-]+\s+){0,3}?(?:\d\s*(?:br|bd|bed|bedroom)s?|house|home|apartment|apt|townhouse|condo|flat)\b/, 'room in a larger unit'],
    [/(?<!\bno\s)\broom ?mates?\b/, 'mentions roommates'],
    [/\bhouse ?mates?\b/, 'mentions housemates'],
    // Kitchens and baths, not amenity phrases like "shared laundry" or "shared spaces".
    [/\bshared\s+(?:kitchen|bath|bathroom|living\s+room|house|home|apartment|apt)\b/, 'shared kitchen, bath or home'],
    [/\b(?:rent|renting)\s+(?:a|one|1)\s+(?:bed)?room\b/, 'room for rent'],
    // Student and coliving buildings often price and lease each bed separately.
    [/(?:\bper|\/)\s*(?:bed|person|room)\b(?!\s*(?:apartment|apt|unit|home|house|condo))/, 'priced per bed or person'],
    [/\b(?:individual|by[- ]the[- ]bed|per[- ]bed)\s+leas/, 'individual leases'],
  ];
  const MIN_STUDIO_SQFT = 150;

  /**
   * Return {type: 'coliving' | 'room', reasons: [...]}, or null when nothing
   * suggests the listing is less than a whole unit.
   */
  function classify(listing) {
    const text = normalize([listing.title, listing.text].filter(Boolean).join(' \n '));
    const reasons = [];
    let type = null;
    for (const [pattern, reason] of COLIVING_PATTERNS) {
      if (pattern.test(text)) { type = 'coliving'; reasons.push(reason); break; }
    }
    for (const [pattern, reason] of ROOM_PATTERNS) {
      if (pattern.test(text) && !reasons.includes(reason)) { type = type || 'room'; reasons.push(reason); }
    }
    if (listing.sqft && listing.sqft < MIN_STUDIO_SQFT && (listing.beds == null || listing.beds <= 1)) {
      type = type || 'room';
      reasons.push(`under ${MIN_STUDIO_SQFT} ft²`);
    }
    return type ? {type, reasons} : null;
  }

  const FLAG_LABELS = {room: 'Room?', coliving: 'Co-living?'};
  const flagLabel = flag => flag ? FLAG_LABELS[flag.type] : '';

  /**
   * Apply the room filter mode to deduplicated listings.
   * 'off'  no classification
   * 'tag'  keep everything, flag possible rooms, list them last
   * 'dim'  same as tag, rendered faded
   * 'hide' remove possible rooms
   * Returns {visible: [{listing, flag}], hidden: count}.
   */
  function applyRoomFilter(listings, mode) {
    if (mode === 'off') return {visible: listings.map(listing => ({listing, flag: null})), hidden: 0};
    const entries = listings.map(listing => ({listing, flag: classify(listing)}));
    if (mode === 'hide') {
      const visible = entries.filter(entry => !entry.flag);
      return {visible, hidden: entries.length - visible.length};
    }
    return {visible: [...entries.filter(e => !e.flag), ...entries.filter(e => e.flag)], hidden: 0};
  }

  root.core = Object.freeze({
    normalize, parseAmount, parseBeds, formatPrice, label, details,
    extractAddress, dedupe, classify, flagLabel, applyRoomFilter,
    ROOM_FILTER_MODES: Object.freeze(['tag', 'dim', 'hide', 'off']),
  });
})();
