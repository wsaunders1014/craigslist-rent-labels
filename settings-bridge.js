// Keep extension storage access in the isolated world.
(() => {
  const DEFAULTS = {groupClick: 'list', maxRows: 3, roomFilter: 'tag'};
  const settings = {...DEFAULTS};
  const changed = new Set();
  function publish() {
    window.postMessage({type: 'crl-settings', ...settings}, location.origin);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of Object.keys(DEFAULTS)) {
      if (changes[key]) {
        changed.add(key);
        settings[key] = changes[key].newValue ?? DEFAULTS[key];
      }
    }
    publish();
  });
  chrome.storage.local.get(DEFAULTS).then(saved => {
    for (const key of Object.keys(DEFAULTS)) if (!changed.has(key)) settings[key] = saved[key];
    publish();
  });
})();
