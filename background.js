// Open the welcome page once per install. Updates never show it; reinstalling does.
chrome.runtime.onInstalled.addListener(({reason}) => {
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.tabs.create({url: 'welcome.html'});
});
