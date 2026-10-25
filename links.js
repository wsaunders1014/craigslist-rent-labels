// Donation link for the welcome and settings pages. Leave empty to hide the links.
// PayPal hosted button JGHKADA9338CG as a link; extension pages cannot load PayPal's button script.
const DONATE_URL = 'https://www.paypal.com/ncp/payment/JGHKADA9338CG';

for (const link of document.querySelectorAll('a[data-donate]')) link.href = DONATE_URL;
if (!DONATE_URL) for (const block of document.querySelectorAll('[data-donate-block]')) block.hidden = true;
