# Apps Script backend

Three web apps sit behind the simulator. Each is deployed from the Apps Script editor as:

- **Execute as:** Me
- **Who has access:** Anyone

Copy the resulting `/exec` URL into `docs/data/endpoints.json`.

| Script | Actions it answers | endpoints.json key |
|--------|-------------------|--------------------|
| Quotation | `doPost` with the JSON quotation body | `quotation` |
| Payment | `checkPaymentCode`, `getQuoteData`, `sendInsuranceEmail`, `testConnection` | `payment` |
| Claims | `verifyPolicy`, `uploadFile`, `submitClaim`, `logOperation` | `claims` |

## Important: the site is static now

The quotation form used to be served by Apps Script itself and submitted with
`google.script.run`. On GitHub Pages that is not available — the page posts to the `/exec`
URL with `fetch` instead.

Two consequences:

1. `doGet()` is no longer the entry point. It can stay, but nobody uses it.
2. `doPost(e)` now really receives an HTTP request, so `e.postData.contents` holds the JSON
   body — which is exactly what the existing code already expects. **No change is needed to
   the quotation `Code.gs` beyond deploying it as a web app.**

Requests are sent with `Content-Type: text/plain` (quotation, payment) or as form-encoded
bodies (claims). Both are "simple requests", so the browser sends no CORS preflight — Apps
Script rejects preflights, and a JSON content type would trigger one.

## Sheet

The quotation script writes to the sheet named in its own `CONFIG.SHEET_ID`.
Headers are created automatically on the first submission.

## Keeping the premium model in step

`docs/assets/premium.js` mirrors `calculateInsurancePremium()` so the quotation page can show
a live estimate while the student types. The rates and factors it reads live in
`docs/data/tariffs.json`. If you change a factor in `Code.gs`, change it there too — otherwise
the on-screen estimate and the emailed quotation will disagree.
