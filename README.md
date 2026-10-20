# Craigslist Rent Labels

A Chrome extension that adds prices and bedroom counts to Craigslist rental maps, groups likely repeated offers, and previews grouped listings without zooming.

Independent community project. Not affiliated with Craigslist or Google. This is an experimental extension, not a Chrome Web Store release.

## Install

1. Download this repository as a ZIP and unzip it, or clone it.
2. Open `chrome://extensions` in desktop Chrome and enable **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Refresh your Craigslist search and open its map view.

**Keep only one copy enabled.** To update, replace the files in the same folder, click the extension's **Reload** button, then refresh Craigslist. Loading every download as a separate extension makes old copies interfere with new ones.

## Features

- Individual labels such as **$2,000 · 1 Br** and **$2,000 · Studio**.
- Compact multi-row grouped markers with **+N more**.
- Deduplication by listing ID, matching title/details, matching leading photo/details, available street address/details, or nearby matching floor-plan offers.
- Scrollable group previews with listing links and available thumbnails, prices, bedrooms, and square footage.
- Toolbar settings for group clicks (**property list** or Craigslist's original **zoom**) and **1–20 marker rows** before +N more. Defaults: property list and three rows.
- Preferences saved locally and applied to already loaded extension tabs automatically.

## Limits

Deduplication groups likely repeated offers, not verified unique apartments. Different units in one building can share prices, sizes, photos, or marketing text. The nearby-offer rule requires matching positive price and square footage, compatible bedrooms, and pins within 25 metres; known conflicting addresses or unit numbers stay separate for that rule. Addresses are read from search location text and titles, not fetched from listing descriptions.

Missing prices retain the original individual marker. Some bedroom counts or images may be unavailable. Native same-location Craigslist popups can still contain duplicate ads. The extension relies on Craigslist's internal Leaflet objects and may need updates when the site changes. Although intended for housing, it currently runs on HTTPS Craigslist search pages generally.

## Privacy and permissions

- No accounts, analytics, telemetry, or external server.
- `storage` saves only the group-click preference and marker row count in `chrome.storage.local`.
- Page access is limited to `https://*.craigslist.org/search/*`.
- Existing listing data is processed locally. Group previews may request Craigslist thumbnail images when shown; the extension does not fetch full listing pages or send listing data to a separate service.

## Development

Plain JavaScript, CSS, and Manifest V3. No build step or dependencies are required to load the extension.

- `content.js`: map labels, offer grouping, and group-click previews (page context).
- `settings-bridge.js`: passes saved preferences from isolated extension context to the page script.
- `settings.html`, `settings.js`, `settings.css`: toolbar popup and Options page.
- `styles.css`: map labels and preview styles.

With Node.js installed, run:

```sh
npm test
```

The dependency-free simulated Leaflet tests cover marker updates, bedroom/studio labels, group row limits, deduplication, group previews, and preference changes. Map labels, studio deduplication, group previews, and settings persistence have also been exercised manually in Chrome. These are not comprehensive automated end-to-end browser tests.

To contribute, fork the repository, make your changes, run the tests, and open a pull request. Bug reports should include the extension version, what happened, and a reproducible public search URL when possible. Do not include account information or private data.

## License

[MIT](LICENSE). You may use, modify, redistribute, and sell copies, provided the copyright and license notice are retained. The license covers this project's code, not Craigslist listings, images, or trademarks.
