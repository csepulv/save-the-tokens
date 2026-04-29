// Sekko popup test fixture.
// On load, fetch example.com and display the status. On button click,
// fetch a second URL with a query parameter so the integration test
// can distinguish click-driven traffic from load-driven traffic.

const statusEl = document.getElementById('status');
const buttonEl = document.getElementById('trigger');

async function fetchAndShow(url, prefix) {
  try {
    const response = await fetch(url, { method: 'GET' });
    statusEl.textContent = `${prefix}: ${response.status}`;
  } catch (err) {
    statusEl.textContent = `${prefix}: error ${err.message}`;
  }
}

fetchAndShow('https://example.com/', 'load');

buttonEl.addEventListener('click', () => {
  fetchAndShow('https://example.com/?clicked=1', 'click');
});
