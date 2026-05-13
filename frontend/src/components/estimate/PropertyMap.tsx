import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Vite breaks Leaflet's default icon auto-resolution; supply paths explicitly
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
})

interface Props {
  coordinates: { lat: number; lng: number }
  address: string
  estimatedPrice: number
}

function fmt(n: number) {
  return new Intl.NumberFormat('da-DK').format(Math.round(n))
}

export default function PropertyMap({ coordinates, address, estimatedPrice }: Props) {
  return (
    <div className="property-map">
      <MapContainer
        center={[coordinates.lat, coordinates.lng]}
        zoom={15}
        style={{ height: '260px', width: '100%', borderRadius: '6px' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={[coordinates.lat, coordinates.lng]}>
          <Popup>
            <strong>{address}</strong><br />
            {fmt(estimatedPrice)} kr
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  )
}
