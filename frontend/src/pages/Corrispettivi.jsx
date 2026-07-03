import { useState, useEffect } from 'react'
import TabAnalisiRicavi from './TabAnalisiRicavi'
import TabStampanteRT from './TabStampanteRT'
import TabControlloRT from './TabControlloRT'
import TabImport from './TabImport'
import TabDocumenti from './TabDocumenti'
import TabGiornalieri from './TabGiornalieri'
import TabTest from './TabTest'
import TabFatturati from './TabFatturati'
import api from '../api/client'
import { isAdmin } from '../utils/corrispettiviHelpers'

// ─────────────────────────────────────────────────────────────────────────────

const LS_TAB = 'corrispettivi_tab'
const LS_LORDO = 'corrispettivi_lordo'

const TABS_BASE = [
  { id: 'import', label: 'Import' },
  { id: 'giornalieri', label: 'Corrispettivi giornalieri' },
  { id: 'scontrini', label: 'Scontrini' },
  { id: 'fatture', label: 'Fatture' },
  { id: 'fatturati', label: 'Riepilogo Fatturati' },
  { id: 'rt', label: 'Controllo RT' },
  { id: 'rt-stampante', label: 'Stampante RT' },
  { id: 'analisi', label: 'Analisi Ricavi' },
]
const TABS_ADMIN = [
  ...TABS_BASE,
  { id: 'test', label: 'Dati di test' },
]

export default function Corrispettivi() {
  const tabsDisponibili = isAdmin() ? TABS_ADMIN : TABS_BASE
  const [tab, setTab] = useState(() => localStorage.getItem(LS_TAB) || 'giornalieri')
  const [hotels, setHotels] = useState([])
  const [lordo, setLordo] = useState(() => {
    const v = localStorage.getItem(LS_LORDO)
    return v === null ? true : v === 'true'
  })
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    api.get('/hotels/').then(r => setHotels(r.data)).catch(() => {})
  }, [])

  const cambiaTab = (id) => {
    setTab(id)
    localStorage.setItem(LS_TAB, id)
  }
  const cambiaLordo = (v) => {
    setLordo(v)
    localStorage.setItem(LS_LORDO, String(v))
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Corrispettivi</h1>

        {/* Toggle IVA globale */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fff7ed', border: '1.5px solid #fdba74', borderRadius: 8, padding: '5px 8px' }}>
          <span style={{ fontSize: '0.85rem', color: '#9a3412', fontWeight: 600 }}>Valori:</span>
          <button onClick={() => cambiaLordo(true)} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: lordo ? 700 : 400,
            background: lordo ? '#ea580c' : 'transparent', color: lordo ? '#fff' : '#9a3412',
          }}>IVA inclusa</button>
          <button onClick={() => cambiaLordo(false)} style={{
            padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: !lordo ? 700 : 400,
            background: !lordo ? '#ea580c' : 'transparent', color: !lordo ? '#fff' : '#9a3412',
          }}>IVA esclusa</button>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', marginBottom: '1.5rem', flexWrap: 'wrap', gap: 0 }}>
        {tabsDisponibili.map(t => (
          <button key={t.id} onClick={() => cambiaTab(t.id)} style={{
            padding: '8px 18px', border: 'none',
            borderBottom: tab === t.id ? '2px solid #1e3a5f' : '2px solid transparent',
            background: 'none', cursor: 'pointer', fontSize: '0.88rem',
            fontWeight: tab === t.id ? 700 : 400,
            color: tab === t.id ? '#1e3a5f' : '#64748b',
            marginBottom: -2, transition: 'all .15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Contenuto tab */}
      {tab === 'import' && (
        <TabImport onImportato={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === 'giornalieri' && (
        <TabGiornalieri lordo={lordo} key={refreshKey} />
      )}
      {tab === 'scontrini' && (
        <TabDocumenti
          key={`sc_${refreshKey}`}
          endpoint="/corrispettivi/scontrini"
          tipo="scontrino"
          lordo={lordo}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'fatture' && (
        <TabDocumenti
          key={`ft_${refreshKey}`}
          endpoint="/corrispettivi/fatture"
          tipo="fattura"
          lordo={lordo}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'fatturati' && (
        <TabFatturati lordo={lordo} />
      )}
      {tab === 'rt' && (
        <TabControlloRT />
      )}
      {tab === 'rt-stampante' && (
        <TabStampanteRT isAdmin={isAdmin()} />
      )}
      {tab === 'analisi' && (
        <TabAnalisiRicavi hotels={hotels} isAdmin={isAdmin()} />
      )}
      {tab === 'test' && isAdmin() && (
        <TabTest onPulito={() => setRefreshKey(k => k + 1)} />
      )}
    </div>
  )
}
