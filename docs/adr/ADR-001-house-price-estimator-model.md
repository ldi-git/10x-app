# ADR-001: House Price Estimator — Comparable-Sales Median Model

**Status:** Accepted  
**Date:** 2026-05-13 (updated 2026-05-13: residential-only scope)  
**Deciders:** Lars Dideriksen / Geomatic  
**Technical Story:** docs/specs/house-price-estimator.md

## Context

Geomatic needs a house price estimator that can compete with the existing AVM (`PropertyData_AVM` on geo-thor). The existing AVM is a black-box model — its internal mechanics are not transparent to end users, and it cannot serve as the basis for a competing, independently verifiable estimate.

We have access to open-market transaction data in `Stag_Datafordeler_EJF` (Ejerskifte + Handelsoplysninger) and building characteristics in `Stag_Datafordeler_BBR`, both via geo-sif. A new model must:

1. Use only open-market sales data — not the existing AVM as a signal
2. Be fully explainable (users must see which transactions drove the estimate)
3. Deliver results in under 15 seconds
4. Be buildable within a workshop session without a data science pipeline
5. Cover only properties where people can live — commercial, industrial, and agricultural buildings are out of scope

The key architectural question is: **what estimation approach to use**, and **where to execute it**.

## Decision

We use a **comparable-sales median model** running inside a Supabase Edge Function:

- Restrict scope to **residential properties only**: BBR `byg021BygningensAnvendelse` codes 110–199 (villa, terraced house, apartment, student housing, residential institution, annex, other year-round residence). Non-residential BFEs are rejected at the subject-lookup step with a descriptive error
- Find open-market sales (`overdragelsesmåde = 'Almindelig fri handel'`) in the same municipality, same building use type (`byg021`), living area within ±30%, within the last 3 years — comparables are also filtered to `byg021 BETWEEN 110 AND 199`
- Compute `median(kontantKøbesum / byg039)` across those comparables
- Multiply by the subject property's living area to get the estimate
- Enrich with the current Nationalbank lending rate (`DNRENTM/OIRNAA`) as market context
- All geo-sif queries execute inside the Edge Function — the frontend never touches the database directly

The join path from BFE to building features is:
`Ejendomsrelation.bfeNummer → BygningEjendomsrelation (via id_lokalId = bygningPåFremmedGrund) → Bygning`

## Consequences

### Positive

- Fully explainable: every estimate shows the exact comparable transactions that produced it
- No dependency on `PropertyData_AVM` — the model is independently derived
- Simple enough to implement and verify in a single sprint
- Median is robust to outlier sales (foreclosures, family transfers at atypical prices)
- Open-market filter (`'Almindelig fri handel'`) removes 7.7 M clean records from noise — the signal is strong
- Edge Function isolation means geo-sif credentials never reach the browser
- Residential scope (`byg021` 110–199) ensures comparables are always like-for-like; mixing residential and commercial sales would produce meaningless price/m² medians

### Negative

- No adjustment for property-specific quality differences (condition, renovation, view) — two houses of the same size and type will get the same estimate even if one is renovated
- Rural BFEs with few comparables produce less reliable estimates; the area-widening fallback helps but doesn't eliminate the problem
- Median price/m² ignores non-linear size effects (larger homes typically sell at a lower per-m² price)
- Cross-database joins across `Stag_Datafordeler_EJF`, `Stag_Datafordeler_BBR`, and `Stag_Datafordeler_DAR` on a single SQL Server instance add query complexity and can be slow without proper indexing

### Neutral

- Estimate is saved automatically on each lookup — history grows over time and needs periodic pruning
- The Nationalbank rate is informational context only; it does not adjust the estimate

## Options Considered

### Option 1: Comparable-sales median (chosen)
- **Pros:** Transparent, auditable, fast to build, no ML pipeline, robust median statistic, directly uses raw transaction data
- **Cons:** No quality adjustment, struggles in thin markets

### Option 2: Hedonic regression (OLS on BBR features)
- **Pros:** Accounts for multiple property attributes simultaneously; more statistically rigorous
- **Cons:** Requires training a model, managing feature engineering, and serving predictions — far beyond a single sprint; black-box relative to option 1

### Option 3: Use `PropertyData_AVM` as a baseline and adjust
- **Pros:** Leverages an existing calibrated model
- **Cons:** Explicitly ruled out by product requirement — the estimator must compete with, not depend on, the AVM

### Option 4: DAWA/OIS external API
- **Pros:** No geo-sif dependency
- **Cons:** Does not expose raw transaction-level data needed for the comparables view; cannot be used to build an explainable model

## Related Decisions

- Address search uses `Stag_Datafordeler_DAR.Husnummer.adgangsadressebetegnelse` for pre-formatted display strings and `adgangTilBygning` as the direct FK to `Bygning` — no join to `NavngivenVej`/`Postnummer` required (confirmed against live schema 2026-05-13)
- RLS on the `estimates` table ensures user history isolation — no separate access control layer needed

## Notes

- `overdragelsesmåde = 'Almindelig fri handel'` confirmed as the open-market code by querying `DISTINCT overdragelsesmåde` on live data (7,685,768 records). `'Almindelig fri handel særlige vilkår'` (2,599 records) is excluded for now.
- `BygningEjendomsrelation` does not expose a named `ejendomsrelation` FK column — the correct join is `Ejendomsrelation.id_lokalId = BygningEjendomsrelation.bygningPåFremmedGrund`. Verified against live data.
- Fallback strategy: if fewer than 5 comparables found with area constraint, drop the ±30% area filter. If still fewer than 5, a `limited_data` flag is returned to the UI.
- Residential use codes confirmed against live BBR data (2026-05-13): 110 (939k), 120 (8.1M), 121, 122, 130 (1.5M), 131, 132, 140 (964k), 150, 160, 185, 190. All 12 codes fall within 110–199; the `BETWEEN 110 AND 199` filter captures all of them without enumerating each.
