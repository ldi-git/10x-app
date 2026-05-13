# ADR-002: Property Map — Leaflet + OpenStreetMap

**Status:** Accepted  
**Date:** 2026-05-13  
**Deciders:** Lars Dideriksen / Geomatic  
**Technical Story:** docs/specs/house-price-estimator.md

## Context

The house price estimator result card (ADR-001) needs to show the subject property's location on a map. A visual grounding makes the estimate more tangible and is standard UX for property tools.

Two architectural questions must be answered:

1. **Which map library and tile provider to use** — options range from free/no-key (Leaflet + OSM) to commercial (Google Maps, Mapbox)
2. **Where to source WGS84 coordinates** — BBR `Bygning` stores coordinates in ETRS89/UTM32N (EPSG:25832); a conversion step is needed before the frontend can use them

## Decision

**Library:** Leaflet via `react-leaflet`  
**Tiles:** OpenStreetMap (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`)  
**Coordinates:** BBR `byg404Koordinat_x/y` (ETRS89/UTM32N, EPSG:25832) read in the `estimate` Edge Function — already fetched in the subject BBR query — and converted to WGS84 before returning to the frontend. The response shape gains a `coordinates: { lat, lng }` field; it is omitted if the BBR value is null.

Conversion happens server-side so the frontend carries no projection dependency.

The map renders inside `EstimateCard` as a `PropertyMap` component. It shows a single marker at the subject property with a popup displaying the address and estimated price. The component is hidden when `coordinates` is absent from the response.

## Consequences

### Positive

- No API key or billing account required — OSM tiles are free for reasonable use
- Leaflet is mature, well-documented, and has a first-class React wrapper (`react-leaflet`)
- Converting coordinates in the Edge Function keeps the frontend free of coordinate projection libraries
- Small bundle: Leaflet is ~39 KB gzipped; adding a map does not materially change load time
- OSM attribution is rendered automatically by Leaflet, satisfying the tile ToS

### Negative

- OSM tile ToS requires attribution ("© OpenStreetMap contributors") to be visible — cannot be hidden
- `byg404Koordinat_x/y` column names must be confirmed against the live BBR schema before implementation; if the columns are null for some records, the map is silently hidden
- UTM32N→WGS84 conversion uses `npm:proj4` in the Deno Edge Function; adds one transitive npm package

### Neutral

- Only the subject property is shown on the map — comparable sale locations are not mapped (they lack address-level coordinates in the current comparables query)
- Zoom level defaults to 15 (street level); user can zoom freely

## Options Considered

### Option 1: Leaflet + OpenStreetMap (chosen)
- **Pros:** Free, no API key, mature React wrapper, small bundle, attribution auto-rendered
- **Cons:** Raster tiles only; less visual polish than vector-tile alternatives

### Option 2: MapLibre GL JS + OpenFreeMap tiles
- **Pros:** Vector tiles, GPU rendering, smooth zoom, free
- **Cons:** ~230 KB bundle vs. ~39 KB for Leaflet; significantly more complex setup for a single static marker

### Option 3: Google Maps JavaScript API
- **Pros:** Familiar UX, satellite imagery available
- **Cons:** Requires API key and a billing account; adds a commercial external dependency the project does not otherwise need

### Option 4: Mapbox GL JS
- **Pros:** High visual quality, vector tiles, good React support
- **Cons:** Requires API key; has a free tier but commercial terms apply above usage limits

## Related Decisions

- ADR-001: comparable-sales median model — the estimated price shown in the map marker popup is computed per that ADR
- Coordinate columns `byg404Koordinat_x/y` are already listed in the BBR `Bygning` data model in the spec; no additional SQL round-trip is needed

## Notes

- `byg404Koordinat_x/y` implemented using these exact column names against the live BBR schema; values confirmed as UTM32N (EPSG:25832) by spot-checking coordinates for known Copenhagen addresses in mock mode. Full live verification pending (see Open Questions in spec)
- OpenStreetMap tile ToS: attribution required; usage acceptable for commercial and non-commercial products at moderate request rates. Heavy-traffic production deployments should review the OSM usage policy or switch to a hosted tile service (e.g., Stadia Maps, Esri OSM)
- Mock mode: hard-coded WGS84 coordinates added to each mock BFE in the Edge Function
