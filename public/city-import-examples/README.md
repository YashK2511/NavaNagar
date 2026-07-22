# City import examples

Both examples contain fictional **Pragati Nagar** data. They are safe for testing only and must not be presented as municipal evidence.

## 1. Quick demo file

Import `quick-demo-city.json` through **Choose city.json**.

## 2. GeoJSON municipal-style package

Through **Choose GeoJSON city package**, select all six files inside `geojson-city-package` at the same time:

- `city.json`
- `wards.geojson`
- `roads.geojson`
- `facilities.geojson`
- `candidate_sites.geojson`
- `risk_zones.geojson`

The GeoJSON package uses normal longitude/latitude-style coordinates. The app normalizes them only for display; the package itself remains in its original coordinate values.

For a real city, replace every geometry, planning attribute, and provenance source with validated municipal data before using any recommendation in a real decision.
