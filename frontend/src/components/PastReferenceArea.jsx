import { ReferenceArea } from 'recharts'

// Funzione (non componente) che restituisce un <ReferenceArea> diretto per Recharts.
// Recharts riconosce i figli per tipo: un componente wrapper viene ignorato,
// bisogna restituire <ReferenceArea> inline con {pastReferenceArea(...)}.
//
// dateKey    — chiave con data ISO YYYY-MM-DD per confronto con la data di riferimento
// displayKey — chiave usata sull'XAxis (default = dateKey)
// refDate    — data di riferimento ISO (default = oggi); passare snapshot_date per snapshot storici
export default function pastReferenceArea(data, dateKey, displayKey, refDate) {
  const dk = displayKey || dateKey
  if (!data || data.length < 2) return null
  const oggi = refDate || new Date().toISOString().slice(0, 10)
  let cutoff = null
  for (const d of data) {
    if (d[dateKey] <= oggi) cutoff = d[dk]
  }
  if (!cutoff) return null
  return (
    <ReferenceArea
      x1={data[0][dk]}
      x2={cutoff}
      fill="#1e293b"
      fillOpacity={0.07}
      ifOverflow="visible"
    />
  )
}
