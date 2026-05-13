import proj4 from 'npm:proj4'

// ETRS89 / UTM zone 32N — Danish national coordinate system used in BBR
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs')

export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function utmToWgs84(x: number, y: number): { lat: number; lng: number } | null {
  try {
    const [lng, lat] = proj4('EPSG:25832', 'WGS84', [x, y]) as [number, number]
    return { lat: +lat.toFixed(6), lng: +lng.toFixed(6) }
  } catch {
    return null
  }
}

export interface DbConfig {
  server: string
  port: number
  user: string | undefined
  password: string | undefined
  options: { encrypt: boolean; trustServerCertificate: boolean }
  requestTimeout: number
}

export function parseConnectionString(raw: string): DbConfig {
  const parts = Object.fromEntries(
    raw.split(';').filter(Boolean).map((s) => {
      const idx = s.indexOf('=')
      return [s.slice(0, idx).trim().toLowerCase(), s.slice(idx + 1).trim()]
    })
  )
  const [server, portStr] = (parts['server'] ?? '').split(',')
  return {
    server,
    port: portStr ? parseInt(portStr) : 1433,
    user: parts['user id'],
    password: parts['password'],
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 12000,
  }
}

export function getConfig(): DbConfig {
  const raw = Deno.env.get('GEO_SIF_CONN')
  if (!raw?.trim()) throw new Error('GEO_SIF_CONN secret is not configured')
  return parseConnectionString(raw)
}
