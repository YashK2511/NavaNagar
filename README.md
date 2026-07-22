# NavaNagar Planning Studio

An explainable, synthetic-city planning prototype. It recommends the best location for a new emergency-response hub using transparent, scenario-aware scoring.

## Run

```bash
npm install
npm run dev
```

Open the local URL shown by Vite.

For the presentation sequence, see [DEMO.md](./DEMO.md).

## What is included

- A reliable, local SVG planning map with clickable wards, care centres, candidate parcels, layer controls, zoom, pan, and pinch zoom.
- Two synthetic city datasets plus reusable one-file and six-file GeoJSON city imports.
- Transparent weighted scoring: travel-time coverage (40%), unmet need (25%), future growth (15%), land/cost (10%), and resilience (10%).
- A local natural-language brief interpreter that converts a hospital request into reviewable planning assumptions; it does not calculate the ranking.
- Scenario controls, data-quality review, source declarations, reliability labels, and a print-ready planning report.

## Importing another city

Use **Change city → Add your city**. For the recommended route, select all six files together:

```text
city.json
wards.geojson
roads.geojson
facilities.geojson
candidate_sites.geojson
risk_zones.geojson
```

The project includes fictional test data in [public/city-import-examples](./public/city-import-examples). Record the municipal source and reliability for each imported layer before creating a report.

## Local backend foundation

The prototype includes an optional local API for durable saved-city and decision-history data. It does not need an account, database, or API key.

```bash
npm run api
```

It starts at `http://localhost:8787` and stores its data in `server/data/navanagar.json`. The current interface remains browser-first until the next integration phase, so it still works when this API is not running.

### Live AI map drafts

To let users generate a new illustrative Hyderabad scenario layer from a planning request, create `.env.local` with an `OPENAI_API_KEY` and start the local API in a second terminal:

```bash
npm run api
```

API billing and ChatGPT subscriptions are separate. The map labels every AI result as a draft; it must be validated against municipal data before any real-world decision.

## Important disclaimer

Every built-in place, boundary, parcel, population, cost, and risk value is synthetic and illustrative. Imported packages are self-declared and still require municipal verification before a real planning decision.
