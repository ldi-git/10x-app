# House Price Estimator Specification

**Status:** Draft  
**Owner:** Lars Dideriksen / Geomatic  
**Created:** 2026-05-13  
**Last Updated:** 2026-05-13 (per-unit pricing, map, geographic comparables, auth, mock mode, ejerbolig filter, input validation, error responses)

## Overview

A new house price model that estimates the open-market value of a Danish property using a comparable-sales approach. The model is built entirely from open-market transaction data in the Datafordeler registers and enriched with building characteristics from BBR and an external mortgage rate signal. It is designed to compete with the existing AVM — the existing AVM is not used as an input anywhere.

A signed-in user enters an address or BFE number, sees an estimated price with the comparable transactions that drove it, and can save estimates to their personal history.

## Goals

- Estimate the open-market value of any Danish **residential** property (BBR `byg021` 110–190), keyed by BFE number
- Base the estimate solely on open-market sales from `Stag_Datafordeler_EJF` (filter: `overdragelsesmåde` = free trade), not the existing AVM
- Show the comparable transactions that drive the estimate so the result is fully explainable
- Enrich with one external market signal: current mortgage rate from Danmarks Nationalbank
- Persist estimates per user in Supabase for history and comparison

## Non-Goals

- Using or referencing `PropertyData_AVM` (geo-thor) in any way
- Training a full ML regression pipeline — comparable-sales median is the model for this iteration
- Non-Danish properties
- Non-residential properties — only BBR `byg021` codes 110–190 (residential use) are in scope; commercial (200+), industrial (300+), and agricultural buildings are excluded
- Properties with `byg021` outside 110–190 return a "not a residential property" error
- Legal or financial guarantee on the estimate

## User Stories

### As a signed-in user, I want to enter an address and receive an estimated market price based on real comparable sales so that I can assess property value independently of the existing AVM

**Acceptance Criteria:**
- [ ] I can type a partial address and get autocomplete suggestions from `Stag_Datafordeler_DAR`
- [ ] After selecting a property, I see an estimated price within 15 seconds
- [ ] If the property is not residential (BBR `byg021` outside 110–190) I see a clear error message
- [ ] The estimate uses only open-market sales (`overdragelsesmåde` = free trade, last 3 years)
- [ ] I see the key property facts: building use type, living area (m²), year built, municipality
- [ ] I see the comparable transactions used (up to 10): address, sale price, sale date, area
- [ ] I see the current Danish mortgage base rate as market context
- [ ] I see the property location on a map (Leaflet + OpenStreetMap, single marker)
- [ ] For multi-unit buildings (apartments), I see a per-unit price breakdown (each unit's address, area, rooms, and estimated price)

### As a signed-in user, I want to review my previous estimates so that I can compare valuations over time

**Acceptance Criteria:**
- [ ] Each estimate is automatically saved to my history
- [ ] History shows BFE, address, estimated price, and date
- [ ] I can delete entries
- [ ] I cannot see other users' estimates (RLS)

## Technical Design

### Architecture

```
[React frontend]
  │
  ├─ Address search  → Supabase Edge Function: address-search
  │                    → geo-sif: Stag_Datafordeler_DAR (Husnummer, NavngivenVej, Postnummer)
  │                    → geo-sif: Stag_Datafordeler_BBR (Ejendomsrelation → bfeNummer)
  │
  ├─ Estimate        → Supabase Edge Function: estimate
  │                    → geo-sif: Stag_Datafordeler_BBR.Bygning (features)
  │                    → geo-sif: Stag_Datafordeler_BBR.Ejendomsrelation (BFE → building)
  │                    → geo-sif: Stag_Datafordeler_EJF.Ejerskifte (open-market sales by BFE)
  │                    → geo-sif: Stag_Datafordeler_EJF.Handelsoplysninger (sale prices)
  │                    → Danmarks Nationalbank open API (mortgage rate)
  │
  └─ History CRUD    → Supabase estimates table (RLS per user)
```

The frontend never queries geo-sif directly. All DB access is through Edge Functions holding connection strings as secrets.

Both Edge Functions require a valid Supabase JWT (`Authorization: Bearer <token>`). Unauthenticated requests return 401.

A `MOCK_GEO_SIF=true` environment variable (set in `supabase/functions/.env`, gitignored) switches both functions to return fixture data without connecting to geo-sif. This enables local demo without SQL Server credentials. The Nationalbank rate is still fetched live in mock mode. Mock comparable sets are keyed by `${municipality_code}_${building_use}` so each mock property returns a distinct estimate at market-appropriate price levels for its city.

### Data Model

**New Supabase table: `estimates`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| user_id | uuid FK → auth.users | RLS: owner only |
| bfe_number | bigint | Subject property |
| address_text | text | Display label |
| estimated_price | numeric | Computed in DKK |
| price_per_m2 | numeric | Median price/m² of comparables |
| comparable_count | int | Number of comparable sales used |
| living_area_m2 | numeric | `byg039BygningensSamledeBoligAreal` |
| build_year | int | `byg026Opførelsesår` |
| building_use | int | `byg021BygningensAnvendelse` |
| municipality_code | varchar(4) | `kommunekode` |
| interest_rate | numeric | Nationalbank rate at time of lookup |
| created_at | timestamptz | Default now() |

**geo-sif sources (all read-only, accessed via Edge Function):**

| Database | Table | Key columns used |
|----------|-------|-----------------|
| `Stag_Datafordeler_EJF` | `Ejerskifte` | `bestemtFastEjendomBFENr`, `overdragelsesmåde`, `overtagelsesdato`, `handelsoplysningerLokalId` |
| `Stag_Datafordeler_EJF` | `Handelsoplysninger` | `id_lokalId`, `kontantKøbesum`, `afståelsesdato` |
| `Stag_Datafordeler_BBR` | `Bygning` | `byg021`, `byg026`, `byg038`, `byg039`, `byg054`, `byg056`, `byg404Koordinat_x/y`, `kommunekode` |
| `Stag_Datafordeler_BBR` | `Ejendomsrelation` | `bfeNummer`, `ejendomstype`, `kommunekode` |
| `Stag_Datafordeler_BBR` | `BygningEjendomsrelation` | joins `Bygning` → `Ejendomsrelation` |
| `Stag_Datafordeler_BBR` | `Enhed` | `enh020EnhedensAnvendelse` (unit use type), `enh023Boligtype` (ownership type — `'1'`=ejerbolig, `'2'`=privat udlejning, `'3'`=almene boliger, `'4'`=andelsbolig), `enh026EnhedensSamledeAreal` (unit area), `enh031AntalVærelser` (rooms), `adresseIdentificerer` → DAR Husnummer |
| `Stag_Datafordeler_DAR` | `Husnummer` | address → BBR building link (`husnummer` FK) |
| `Stag_Datafordeler_DAR` | `NavngivenVej` | street name |
| `Stag_Datafordeler_DAR` | `Postnummer` | postal code + city name |

### Estimation Model

**Comparable sales approach:**

1. Look up subject BFE → `Ejendomsrelation.bfeNummer` → join `BygningEjendomsrelation` on `er.id_lokalId = ber.bygningPåFremmedGrund` → join `Bygning` on `ber.bygning = b.id_lokalId` (living area, type, year, municipality)
2. Find open-market comparables:
   - Join `Ejerskifte` (filter: `overdragelsesmåde` = open market, `overtagelsesdato` last 3 years, `registreringTil IS NULL`) → `Handelsoplysninger` (`kontantKøbesum > 0`)
   - Same `byg021BygningensAnvendelse` (building use type), within 5 km of the subject property, living area within ±30%
   - **Owner-occupied only:** requires `EXISTS` in `BBR.Enhed` with `enh023Boligtype = '1'` — excludes rental properties, almene boliger (social housing), and andelsboliger (cooperative, price-regulated)
   - Geographic distance uses UTM32N Euclidean distance on `byg404Koordinat_x/y` — no projection needed, values are in metres
3. `price_per_m2` = median(`kontantKøbesum / byg039`) across comparables
4. `estimated_price` = `price_per_m2 × subject_living_area`
5. Query `BBR.Enhed` for all residential units within the building (`enh020 BETWEEN 110 AND 199`, `enh026 > 0`). If > 1 unit: compute `unit_estimated_price = price_per_m2 × unit_area` for each and include a `units` array in the response
5. Fallback: if < 5 comparables, progressively relax constraints:
   - Drop ±30% area constraint (keep 5 km radius)
   - Widen radius to 10 km (no area constraint)
   - If BBR coordinates are null for subject: fall back to municipality-scoped search with same area/widening logic
   - If still < 5: return `limited_data: true` flag to UI

**Core query pattern (Edge Function SQL):**
```sql
SELECT TOP 20
  ek.bestemtFastEjendomBFENr          AS bfe,
  h.kontantKøbesum                    AS sale_price,
  CONVERT(varchar(10), ek.overtagelsesdato, 23) AS sale_date,
  b.byg039BygningensSamledeBoligAreal AS living_area_m2
FROM Stag_Datafordeler_EJF.dbo.Ejerskifte ek
JOIN Stag_Datafordeler_EJF.dbo.Handelsoplysninger h
  ON ek.handelsoplysningerLokalId = h.id_lokalId
JOIN Stag_Datafordeler_BBR.dbo.Ejendomsrelation er
  ON ek.bestemtFastEjendomBFENr = er.bfeNummer
JOIN Stag_Datafordeler_BBR.dbo.BygningEjendomsrelation ber
  ON er.id_lokalId = ber.bygningPåFremmedGrund
JOIN Stag_Datafordeler_BBR.dbo.Bygning b
  ON ber.bygning = b.id_lokalId
WHERE ek.overdragelsesmåde            = 'Almindelig fri handel'
  AND ek.registreringTil              IS NULL
  AND ek.overtagelsesdato             >= DATEADD(year, -3, GETDATE())
  AND h.kontantKøbesum                > 0
  AND b.byg021BygningensAnvendelse    BETWEEN 110 AND 199
  AND b.byg021BygningensAnvendelse    = @building_use
  AND b.byg039BygningensSamledeBoligAreal > 0
  AND b.byg404Koordinat_x             IS NOT NULL
  -- bounding box pre-filter (index-friendly), then exact circle check
  AND b.byg404Koordinat_x             BETWEEN @subjectX - @radiusMeters AND @subjectX + @radiusMeters
  AND b.byg404Koordinat_y             BETWEEN @subjectY - @radiusMeters AND @subjectY + @radiusMeters
  AND (
    POWER(CAST(b.byg404Koordinat_x AS FLOAT) - @subjectX, 2) +
    POWER(CAST(b.byg404Koordinat_y AS FLOAT) - @subjectY, 2)
  ) <= POWER(@radiusMeters, 2)
  AND EXISTS (
    SELECT 1 FROM Stag_Datafordeler_BBR.dbo.Enhed e
    WHERE e.bygning = b.id_lokalId
      AND e.registreringTil IS NULL
      AND e.enh023Boligtype = '1'  -- ejerbolig only; excludes rental, social, andelsbolig
  )
  AND b.byg039BygningensSamledeBoligAreal
      BETWEEN @living_area * 0.7 AND @living_area * 1.3  -- dropped in widened fallback
```

`@subjectX / @subjectY` are the subject building's `byg404Koordinat_x/y` (UTM32N, metres). The bounding-box filter pre-reduces the scan to a square; the squared-distance check then refines to the exact circle.

### API Design

**`GET /functions/v1/address-search?q={text}`**
```json
[{ "bfe_number": 100442, "display": "Testvej 12, 2200 København N" }]
```

**`POST /functions/v1/estimate`**
```json
// Request
{ "bfe_number": 100442 }

// Response
{
  "bfe_number": 100442,
  "address": "Testvej 12, 2200 København N",
  "estimated_price": 3250000,
  "price_per_m2": 22887,
  "living_area_m2": 142,
  "build_year": 1978,
  "building_use": 120,
  "municipality_code": "0101",
  "comparable_count": 14,
  "comparables": [
    {
      "bfe": 100399,
      "address": "Nabovej 4, 2200 København N",
      "sale_price": 3100000,
      "sale_date": "2025-03-12",
      "living_area_m2": 138
    }
  ],
  "interest_rate": 3.35,
  "limited_data": false,
  "coordinates": { "lat": 55.6761, "lng": 12.5683 },
  "units": [
    { "address": "Testvej 12, st. th., 2200 København N", "use_type": 140, "area_m2": 88, "rooms": 3, "estimated_price": 2013256 },
    { "address": "Testvej 12, 1. th., 2200 København N",  "use_type": 140, "area_m2": 92, "rooms": 4, "estimated_price": 2105724 }
  ]
}
```

`coordinates` is WGS84 (EPSG:4326). Source: BBR `byg404Koordinat_x/y` (ETRS89/UTM32N, EPSG:25832), converted to WGS84 via `npm:proj4` inside the Edge Function. Omitted if BBR coordinates are null.

`units` is present only when the building has more than one residential unit (`BBR.Enhed`). Omitted for single-building properties.

`limited_data: true` indicates fewer than 5 comparables were found after all radius-widening fallbacks.

**Error responses:**

| Status | Condition | `error` message |
|--------|-----------|-----------------|
| 400 | Request body is not valid JSON | `"Request body must be valid JSON"` |
| 400 | `bfe_number` missing, not an integer, or ≤ 0 | `"bfe_number must be a positive integer"` |
| 401 | Missing or invalid `Authorization` header | `"Unauthorized"` |
| 404 | BFE not found in BBR | `"Property not found"` |
| 404 | BFE exists but `byg021` is outside 110–199 | `"Not a residential property (BBR use type <code>)"` |
| 422 | All fallback paths exhausted with zero ejerbolig comparable sales | `"No comparable sales found for this property"` |

### UI/UX Design

```
┌──────────────────────────────────────────────────────┐
│  House Price Estimator                               │
│                                                      │
│  🔍 [Enter address...                  ] [Estimate]  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Testvej 12, 2200 København N  · BFE 100442   │  │
│  │                                                │  │
│  │  Estimated value          Property (BBR)       │  │
│  │  3,250,000 kr             Type:   120 (villa)  │  │
│  │  22,887 kr/m²             Size:   142 m²       │  │
│  │  Based on 14 sales        Built:  1978         │  │
│  │                           Muni:   0101         │  │
│  │                                                │  │
│  │  ┌──────────────────────────────────────────┐  │  │
│  │  │  [Leaflet map — OpenStreetMap tiles]     │  │  │
│  │  │                                          │  │  │
│  │  │          📍 Testvej 12                   │  │  │
│  │  │         3,250,000 kr                     │  │  │
│  │  │                                          │  │  │
│  │  │  © OpenStreetMap contributors            │  │  │
│  │  └──────────────────────────────────────────┘  │  │
│  │                                                │  │
│  │  Market context                                │  │
│  │  Mortgage base rate: 3.35%  (Nationalbanken)   │  │
│  │                                                │  │
│  │  Comparable sales                              │  │
│  │  Nabovej 4     3,100,000 kr  138 m²  Mar 2025 │  │
│  │  Sidegaden 7   3,400,000 kr  151 m²  Jan 2025 │  │
│  │  ...                                           │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  My estimate history                                 │
│  Testvej 12 · 3,250,000 kr · 13 May 2026       [×]  │
└──────────────────────────────────────────────────────┘
```

Map shows a single marker at the subject property. Clicking the marker opens a popup with address and estimated price. Attribution "© OpenStreetMap contributors" is required by the OSM tile ToS and rendered by Leaflet automatically.

## Implementation Plan

### Phase 1: Data layer
- [x] Write Supabase migration for `estimates` table with RLS

### Phase 2: Edge Functions
- [x] `address-search`: query DAR (Husnummer + NavngivenVej + Postnummer) with BFE lookup via BBR Ejendomsrelation; JWT auth required
- [x] `estimate`: BFE → BBR features + geographic comparable sales query (UTM32N distance) + Nationalbank rate + median calc + per-unit pricing via BBR Enhed + UTM32N→WGS84 coordinate conversion via proj4

### Phase 3: Frontend
- [x] Add `/estimate` route to `App.tsx`
- [x] `AddressSearch` component — debounced autocomplete
- [x] `EstimateCard` — price, property facts, comparables table, rate, unit breakdown
- [x] `PropertyMap` component — Leaflet map with single marker; popup shows address + estimated price; hidden when `coordinates` absent
- [x] `EstimateHistory` — list with delete

### Phase 4: Verify
- [ ] Test with a known BFE against live geo-sif — confirm comparables are open-market only and geographically scoped
- [ ] Confirm no reference to `PropertyData_AVM` anywhere in call chain
- [ ] RLS test: two users cannot see each other's estimates
- [ ] Verify `byg404Koordinat_x/y` column names and UTM32N values against live BBR schema

## Testing Strategy

- Unit: median price/m² calculation with mocked sale rows
- Integration: Edge Function against geo-sif read-only — validate join path returns rows for a known BFE
- E2E: sign in → search address → get estimate → save → view history → delete

## Rollout Plan

New `/estimate` route in the existing React app, gated behind auth. No feature flag needed. Deploy to local stack, verify end-to-end, open PR.

## Metrics & Success Criteria

- Estimate returns in < 15 seconds for any valid residential BFE
- At least 5 comparables found for BFEs in major municipalities (test: 0101, 0751, 0461)
- `PropertyData_AVM` is not referenced anywhere in the codebase (grep check)
- Zero cross-user data leakage (RLS verified)

## Dependencies

- geo-sif read access for: `Stag_Datafordeler_EJF`, `Stag_Datafordeler_BBR`, `Stag_Datafordeler_DAR` (connection strings as Edge Function secrets)
- Danmarks Nationalbank open REST API (no key required)
- Supabase Edge Functions (Deno runtime)
- `leaflet` + `react-leaflet` (frontend, no API key required)
- OpenStreetMap tile service — no API key; attribution required

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `overdragelsesmåde` open-market value not confirmed | High | Medium | Confirm with Lars before Phase 2; query distinct values first |
| Fewer than 5 comparables in rural municipalities | Medium | High | Auto-widen to region; show "limited data" warning |
| `BygningEjendomsrelation` join returns multiple buildings per BFE | Medium | Medium | Take primary building (highest living area) |
| geo-sif cross-database join performance (3 DBs in one query) | High | Medium | Use DATEADD filter to limit scan; add query timeout of 12s |
| Nationalbank API down | Low | Low | Cache last rate in Supabase; fall back gracefully |

## Open Questions

- [x] **What is the exact string value of `overdragelsesmåde` for open-market free sales?** Confirmed: `'Almindelig fri handel'` (7.7 M records). `'Almindelig fri handel særlige vilkår'` (2,599 records) is excluded for now.
- [x] **Does `BygningEjendomsrelation` expose `ejendomsrelation` as a FK column?** No — the join is `Ejendomsrelation.id_lokalId = BygningEjendomsrelation.bygningPåFremmedGrund`, then `BygningEjendomsrelation.bygning = Bygning.id_lokalId`. Verified against live data.
- [x] **Address search join path confirmed:** `DAR.Husnummer.adgangTilBygning = BBR.Bygning.id_lokalId` → `BygningEjendomsrelation.bygning` → `Ejendomsrelation.bfeNummer`. `Husnummer.adgangsadressebetegnelse` is a pre-formatted full address string — no join to `NavngivenVej`/`Postnummer` needed. Verified live: "Rådhuspladsen 7, 1550 København V" → BFE 100654163.
- [x] **Nationalbank API:** POST to `https://api.statbank.dk/v1/data` with body `{"table":"DNRENTM","format":"JSON","lang":"en","variables":[{"code":"INSTRUMENT","values":["OIRNAA"]},{"code":"Tid","values":["*"]}]}`. Lending rate variable code: `OIRNAA`. Value field in response: `INDHOLD`.
- [ ] **BBR coordinate column names:** Confirm exact names of `byg404Koordinat_x/y` columns in live `Stag_Datafordeler_BBR.dbo.Bygning` schema and verify values are in ETRS89/UTM32N (EPSG:25832). Required before implementing coordinate conversion in the Edge Function.

## References

- geo-sif `Stag_Datafordeler_EJF`: `Ejerskifte`, `Handelsoplysninger` — sales transactions
- geo-sif `Stag_Datafordeler_BBR`: `Bygning`, `Ejendomsrelation`, `BygningEjendomsrelation` — property features
- geo-sif `Stag_Datafordeler_DAR`: `Husnummer`, `NavngivenVej`, `Postnummer` — address search
- Danmarks Nationalbank open data API — mortgage base rate
- Competing model for reference only: geo-thor `PropertyData_AVM`
