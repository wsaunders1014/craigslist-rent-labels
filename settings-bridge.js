// Keep extension storage access in the isolated world.
(() => {
  const settings = {groupClick: 'list', maxRows: 3};
  const changed = new Set();
  function publish() {
    window.postMessage({type: 'crl-settings', ...settings}, location.origin);
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const key of ['groupClick', 'maxRows']) {
      if (changes[key]) {
        changed.add(key);
        settings[key] = changes[key].newValue ?? (key === 'maxRows' ? 3 : 'list');
      }
    }
    publish();
  });
  chrome.storage.local.get(settings).then(saved => {
    for (const key of ['groupClick', 'maxRows']) if (!changed.has(key)) settings[key] = saved[key];
    publish();
  });
})();
