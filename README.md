# Craigslist Rent Labels

A Chrome extension that adds prices and bedroom counts to Craigslist rental maps, groups likely repeated offers, previews grouped listings without zooming, and flags listings that look like a single room or coliving. On apartments.com it flags the same kinds of listings in search results.

Independent community project. Not affiliated with Craigslist or Google. This is an experimental extension, not a Chrome Web Store release.

## Install

1. Download this repository as a ZIP and unzip it, or clone it.
2. Open `chrome://extensions` in desktop Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Refresh your Craigslist search and open its map view.

**Keep only one copy enabled.** To update, replace the files in the same folder, click the extension's **Reload** button, then refresh Craigslist. Loading every download as a separate extension makes old copies interfere with new ones.

## Features

- Individual labels such as **$2,000 · 1 Br** and **$2,000 · Studio**. When a search is limited to a single bedroom count (for example min and max both set to 1), labels show just the price, and bedrooms appear only on listings that differ.
- Compact multi-row grouped markers with **+N more**.
- Deduplication by listing ID, matching title/details, matching leading photo/details, available street address/details, or nearby matching floor-plan offers.
- Scrollable group previews with listing links and available thumbnails, prices, bedrooms, and square footage.
- Possible room and coliving detection, for when a "$1,500 studio" search fills up with rooms in shared units. Choose to **tag** them ("Room?" or "Co-living?", listed last), **fade** them, **hide** them, or turn detection **off**. Default: tag. Never applied on "rooms & shares" searches.
- **apartments.com:** search result cards that look like coliving, rooms, or per-bed student housing get a "Room?" or "Co-living?" badge and a yellow tint that clears on hover, are faded, or are hidden, using the same setting. Map pins for listings shown in the results become green price and bedroom labels, yellow for possible rooms, and follow the same fade or hide setting. When cards are hidden, a small notice shows how many and lets you reveal them for that page.
- Toolbar settings for group clicks (**property list** or Craigslist's original **zoom**) and **1–20 marker rows** before +N more. Defaults: property list and three rows.
- Preferences saved locally and applied to already loaded extension tabs automatically.

## Limits

Deduplication groups likely repeated offers, not verified unique apartments. Different units in one building can share prices, sizes, photos, or marketing text. The nearby-offer rule requires matching positive price and square footage, compatible bedrooms, and pins within 25 metres; known conflicting addresses or unit numbers stay separate for that rule. Addresses are read from search location text and titles, not fetched from listing descriptions.

Missing prices retain the original individual marker. Some bedroom counts or images may be unavailable. Native same-location Craigslist popups can still contain duplicate ads. The extension relies on Craigslist's internal Leaflet objects and may need updates when the site changes. Room and coliving detection reads wording (such as "private room", "roommate", "shared kitchen", "co-living") and unusually small sizes in the title and search location text. Map results do not include full descriptions, so some rooms will be missed and some whole units may be flagged; hover a flagged row to see why it was flagged.

On apartments.com, detection also looks for per-bed or per-person pricing, individual leases, and known coliving operators, using the card's own text. The adapter depends on apartments.com's result card markup (captured October 2026) and may need updates when the site changes. Map pin labels use the matching result card, so pins for listings not on the current results page keep apartments.com's own pin.

## Privacy and permissions

- No accounts, analytics, telemetry, or external server.
- `storage` saves only the group-click, marker row count, and room filter preferences in `chrome.storage.local`.
- On apartments.com, the extension reads only result cards already on the page.
- Page access is limited to apartments.com and Craigslist housing searches: apartments (`apa`), all housing (`hhh`), rooms & shares (`roo`), and sublets (`sub`).
- Existing listing data is processed locally. Group previews may request Craigslist thumbnail images when shown; the extension does not fetch full listing pages or send listing data to a separate service.

## Development

Plain JavaScript, CSS, and Manifest V3. No build step or dependencies are required to load the extension.

- `src/core.js`: site-independent listing logic: parsing, labels, deduplication, and room/coliving detection. Works only on the shared Listing shape documented at the top of the file.
- `src/adapters/apartments.js`: reads apartments.com result cards into Listings and tags, fades, or hides possible rooms, and relabels their map pins (isolated world; reads settings from `chrome.storage` directly).
- `src/adapters/craigslist.js`: reads Craigslist's map markers, converts results into Listings, and renders labels and group previews (page context).
- `settings-bridge.js`: passes saved preferences from isolated extension context to the page script.
- `settings.html`, `settings.js`, `settings.css`: toolbar popup and Options page.
- `styles.css`: map labels and preview styles.

### Adding another site

Each site gets its own adapter in `src/adapters/`. An adapter finds listings on the page, converts each one into a Listing (see `src/core.js`), and decides how to display results on that site. Labels, deduplication, and the room filter then work without changes. Add the adapter after `src/core.js` in `manifest.json` with its own `matches`.

### Tests

With Node.js installed, run:

```sh
npm test
```

`apartments.test.cjs` covers apartments.com card parsing and each filter mode with a minimal fake DOM. `core.test.cjs` covers parsing, labels, address matching, room and coliving detection, and filter modes. The dependency-free simulated Leaflet tests in `extension.test.cjs` cover marker updates, bedroom/studio labels, group row limits, deduplication, group previews, room filter modes, and preference changes. Map labels, studio deduplication, group previews, and settings persistence have also been exercised manually in Chrome. These are not comprehensive automated end-to-end browser tests.

To contribute, fork the repository, make your changes, run the tests, and open a pull request. Bug reports should include the extension version, what happened, and a reproducible public search URL when possible. Do not include account information or private data.

## License

[MIT](LICENSE). You may use, modify, redistribute, and sell copies, provided the copyright and license notice are retained. The license covers this project's code, not Craigslist listings, images, or trademarks.
