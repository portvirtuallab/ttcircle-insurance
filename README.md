# TTCircle Insurance — PVL.ONE simulator

The cargo insurance module of the [Port Virtual Lab](https://www.pvl.one). TTCircle is the
simulated insurance operator inside PVL.ONE: participants price and manage cover on the
shipments they build in the commercial, import, export and airfreight modules.

Live site: **https://portvirtuallab.github.io/ttcircle-insurance/**

## The five stages

| # | Stage | Page | What it does |
|---|-------|------|--------------|
| 1 | Risk assessment | `docs/risk-assessment.html` | Scores the route, cargo, mode and value, and recommends a cover level. |
| 2 | Request your quotation | `docs/quotation.html` | Full declaration with a live premium that builds up factor by factor. Submits to the Apps Script backend and returns a quote code. |
| 3 | Report your payment | `docs/payment.html` | Chat assistant: verifies the payment code, retrieves the policy, activates it and emails the certificate. |
| 4 | Cargo manage report | `docs/cargo-report.html` | Damage report form that generates a paginated PDF for the claim file. |
| 5 | Insurance claims | `docs/claims.html` | Verifies the policy, uploads the evidence and registers the claim. |

Plus `docs/glossary.html`, the survey field guide (policy holder vs. beneficiary vs. insured,
and when to add ISRCC / IWC / extraordinary risks).

## Design

Colours, typography, spacing and component shapes come from
[portvirtuallab.github.io/operations](https://portvirtuallab.github.io/operations/) so the
module sits in the same visual family as the rest of PVL.ONE. The tokens live at the top of
`docs/assets/styles.css`; `docs/assets/components.css` holds the interactive pieces (score
dial, accordions, chat, pills, modal).

## Layout

```
docs/                 the published site (GitHub Pages serves this folder)
  assets/
    styles.css        PVL design tokens and layout
    components.css    interactive components
    shared.js         header/footer/stage strip, the case file, helpers
    premium.js        the premium engine, mirrored from the backend
  data/
    config.json       insured-value rule, cover levels, claim causes and documents
    tariffs.json      the full underwriting model: rates, factors, Incoterm rules
    risk-data.json    country risk bands, cargo profiles, cover descriptions
    endpoints.json    the Apps Script /exec URLs
gas/                  the Google Apps Script backend
```

**All the numbers live in `docs/data/`.** Changing a rate, a country band or a risk factor is
a JSON edit — no code changes, no redeploy of anything but the site.

## The case file

Each stage writes what the next one needs into `localStorage` (`ttc.caseFile.v1`), so a
participant who completes the risk assessment finds the quotation form prefilled, and the
claims form already knows the policy number. It is per-browser and disposable — the backend
remains the record of truth.

## Configuration

`docs/data/endpoints.json` holds the deployed Apps Script web-app URLs:

```json
{
  "payment":   "https://script.google.com/macros/s/…/exec",
  "claims":    "https://script.google.com/macros/s/…/exec",
  "quotation": ""
}
```

> ⚠️ `quotation` is empty until the quotation Apps Script is deployed as a web app.
> Until then the quotation page still calculates the live premium, but it will not submit.

These URLs are visible to anyone who opens the pages — that is inherent to a static site.
The Apps Script must therefore validate every request itself and never treat the URL as a
secret.

## Backend

The quotation, payment and claims stages talk to Google Apps Script web apps
(`gas/`). Because GitHub Pages serves static files, the pages call the deployed `/exec` URL
with `fetch` — **not** `google.script.run`, which only works when Apps Script itself serves
the HTML.

Requests are kept "simple" (`text/plain` or form-encoded bodies) so the browser does not send
a CORS preflight, which Apps Script rejects.

Each script must be deployed as: *Execute as* **Me**, *Who has access* **Anyone**.

## Running locally

Any static server works; the pages fetch their JSON, so `file://` will not do.

```bash
python -m http.server 8000 --directory docs
```

Then open http://localhost:8000.

## Disclaimer

A training simulator. Premiums, risk bands and settlements are illustrative and do not
constitute an insurance offer.

---

Escola Europea – Intermodal Transport · Port Virtual Lab
