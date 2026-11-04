// Riquadro in cima alla Home (solo admin): attività ricorrenti in ritardo o in scadenza nei prossimi 7 giorni.
// Se la chiamata fallisce non mostra nulla: il cruscotto resta usabile.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client.js'
import { Messaggio } from '../../components/ui'

export default function RiquadroAttivita() {
  const [r, setR] = useState(null)
  useEffect(() => {
    api.get('/attivita/riepilogo').then(x => setR(x.data)).catch(() => setR(null))
  }, [])
  if (!r || (!r.in_ritardo && !r.da_fare_7gg)) return null
  const parti = []
  if (r.in_ritardo) parti.push(`${r.in_ritardo} attività in ritardo`)
  if (r.da_fare_7gg) parti.push(`${r.da_fare_7gg} da fare entro 7 giorni`)
  return (
    <div style={{ marginBottom: 16 }}>
      <Messaggio tipo={r.in_ritardo ? 'warn' : 'info'}>
        Attività ricorrenti: {parti.join(' · ')} — <Link to="/attivita">apri lo scadenziario</Link>
      </Messaggio>
    </div>
  )
}
