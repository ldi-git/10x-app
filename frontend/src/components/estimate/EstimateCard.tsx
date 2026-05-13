import PropertyMap from './PropertyMap'

interface Comparable {
  bfe: number
  sale_price: number
  sale_date: string
  living_area_m2: number
  address?: string
}

interface Unit {
  address: string
  use_type: number
  area_m2: number
  rooms: number
  estimated_price: number
}

export interface EstimateResult {
  bfe_number: number
  address: string
  estimated_price: number
  price_per_m2: number
  living_area_m2: number
  build_year: number | null
  building_use: number
  municipality_code: string
  comparable_count: number
  comparables: Comparable[]
  interest_rate: number | null
  limited_data?: boolean
  units?: Unit[]
  coordinates?: { lat: number; lng: number }
}

function fmt(n: number) {
  return new Intl.NumberFormat('da-DK').format(Math.round(n))
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('da-DK', { year: 'numeric', month: 'short' })
}

interface Props {
  result: EstimateResult
}

export default function EstimateCard({ result }: Props) {
  return (
    <div className="estimate-card">
      <div className="estimate-header">
        <span className="estimate-address">{result.address}</span>
        <span className="estimate-bfe">BFE {result.bfe_number}</span>
      </div>

      <div className="estimate-body">
        <div className="estimate-value-col">
          <div className="estimate-price">{fmt(result.estimated_price)} kr</div>
          <div className="estimate-ppm2">{fmt(result.price_per_m2)} kr/m²</div>
          <div className="estimate-basis">Based on {result.comparable_count} sales</div>
          {result.limited_data && (
            <div className="estimate-warning">Limited data — area constraint widened</div>
          )}
        </div>

        <div className="estimate-facts-col">
          <table className="facts-table">
            <tbody>
              <tr><th>Type</th><td>{result.building_use}</td></tr>
              <tr><th>Size</th><td>{result.living_area_m2} m²</td></tr>
              {result.build_year && <tr><th>Built</th><td>{result.build_year}</td></tr>}
              <tr><th>Municipality</th><td>{result.municipality_code}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {result.coordinates && (
        <PropertyMap
          coordinates={result.coordinates}
          address={result.address}
          estimatedPrice={result.estimated_price}
        />
      )}

      {result.interest_rate != null && (
        <div className="estimate-rate">
          Mortgage base rate: <strong>{result.interest_rate}%</strong> (Nationalbanken)
        </div>
      )}

      {result.units && result.units.length > 1 && (
        <div className="units">
          <h4>Unit estimates ({result.units.length} units)</h4>
          <table className="comp-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Area</th>
                <th>Rooms</th>
                <th>Estimated price</th>
              </tr>
            </thead>
            <tbody>
              {result.units.map((u, i) => (
                <tr key={i}>
                  <td>{u.address || '—'}</td>
                  <td>{u.area_m2} m²</td>
                  <td>{u.rooms}</td>
                  <td>{fmt(u.estimated_price)} kr</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="comparables">
        <h4>Comparable sales</h4>
        <table className="comp-table">
          <thead>
            <tr>
              <th>Address / BFE</th>
              <th>Price</th>
              <th>Area</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {result.comparables.map((c, i) => (
              <tr key={i}>
                <td>{c.address ?? `BFE ${c.bfe}`}</td>
                <td>{fmt(c.sale_price)} kr</td>
                <td>{c.living_area_m2} m²</td>
                <td>{fmtDate(c.sale_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
