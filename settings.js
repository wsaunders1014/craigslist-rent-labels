(async () => {
  const radios = [...document.querySelectorAll('input[name="groupClick"]')];
  const maxRows = document.getElementById('maxRows');
  const status = document.getElementById('status');
  try {
    const settings = await chrome.storage.local.get({groupClick: 'list', maxRows: 3});
    maxRows.value = Number.isInteger(settings.maxRows) && settings.maxRows >= 1 && settings.maxRows <= 20 ? settings.maxRows : 3;
    maxRows.disabled = false;
    const current = settings.groupClick === 'zoom' ? 'zoom' : 'list';
    radios.forEach(input => { input.checked = input.value === current; input.disabled = false; });
    status.textContent = 'Changes apply to open Craigslist tabs automatically.';
  } catch {
    status.textContent = 'Could not load settings. Reopen this panel to try again.';
  }
  maxRows.addEventListener('change', async () => {
    const value = Number(maxRows.value);
    if (!Number.isInteger(value) || value < 1 || value > 20) {
      status.textContent = 'Enter a whole number from 1 to 20.';
      return;
    }
    maxRows.disabled = true;
    try {
      await chrome.storage.local.set({maxRows: value});
      status.textContent = 'Saved. Applied to open Craigslist tabs.';
    } catch { status.textContent = 'Could not save. Try again.'; }
    finally { maxRows.disabled = false; }
  });
  radios.forEach(input => input.addEventListener('change', async () => {
    if (!input.checked) return;
    radios.forEach(radio => radio.disabled = true);
    try {
      await chrome.storage.local.set({groupClick: input.value});
      status.textContent = 'Saved. Applied to open Craigslist tabs.';
    } catch {
      status.textContent = 'Could not save. Reopen this panel to try again.';
    } finally {
      radios.forEach(radio => radio.disabled = false);
    }
  }));
})();
