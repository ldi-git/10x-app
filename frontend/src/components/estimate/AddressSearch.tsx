import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabaseClient'

interface Suggestion {
  bfe_number: number
  display: string
}

interface Props {
  onSelect: (bfeNumber: number, display: string) => void
  disabled?: boolean
}

export default function AddressSearch({ onSelect, disabled }: Props) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query.length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/address-search?q=${encodeURIComponent(query)}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      })
      if (res.ok) {
        const data: Suggestion[] = await res.json()
        setSuggestions(data)
        setOpen(data.length > 0)
      }
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  function handleSelect(s: Suggestion) {
    setQuery(s.display)
    setSuggestions([])
    setOpen(false)
    onSelect(s.bfe_number, s.display)
  }

  return (
    <div className="address-search">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Enter address..."
        disabled={disabled}
        autoComplete="off"
      />
      {open && (
        <ul className="suggestions">
          {suggestions.map((s) => (
            <li key={s.bfe_number} onClick={() => handleSelect(s)}>
              {s.display}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
