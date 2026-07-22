# NavaNagar Planning Studio — 3-minute demo guide

## Before presenting

```bash
npm run build
npm run dev
```

Open the local Vite URL and leave the app on the **Baseline** scenario.

## 0:00–0:25 — Problem

> Municipal decisions are often made from disconnected spreadsheets, reports, and departmental knowledge. NavaNagar turns those inputs into one explainable planning decision.

Point to the wards, care centres, routes, river corridor, and candidate parcels on the map.

## 0:25–1:00 — Baseline recommendation

Ask: **Where should the next emergency-response hub go?**

Click **Run recommendation**. Explain that Yeola Gateway Parcel wins with a suitability score of **87/100** because it best balances travel-time coverage, unmet need, growth, land cost, and resilience.

Open **Method & assumptions**. Emphasize that the score is transparent and unsafe or non-municipal sites are excluded before ranking.

## 1:00–1:35 — Scenario test

Select **+20% north-east growth**, then click **Run recommendation**.

> The system does not show a static map. It recalculates the recommendation when planning conditions change.

Expected result: Candidate A remains first and its score rises to about **90/100**.

## 1:35–2:05 — Resilience test

Select **Monsoon river buffer**, then click **Run recommendation**.

Open the planning report.

> Candidate C is now excluded because it is exposed to the expanded river-risk buffer. The system makes the risk and the trade-off visible before money is committed.

## 2:05–2:40 — Decision handoff

In the report, show:

- the selected scenario;
- the ranked candidate comparison;
- the implementation sequence; and
- the evidence required before procurement.

Click **Print / Save PDF** to demonstrate a usable decision handoff.

## 2:40–3:00 — Close

> NavaNagar is a synthetic demonstration. In deployment, we replace its input files with verified municipal GIS, ward, land, health, and hazard data—the interface and scoring engine stay the same.

## Recovery checklist

- If the page looks stale, refresh it once.
- If the server is not available, rerun `npm run dev`.
- If build verification is requested, run `npm run build`.
