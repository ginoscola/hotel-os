import { useState } from 'react'
import TabImport from './produzione/TabImport'
import TabGiornaliera from './produzione/TabGiornaliera'
import TabCanali from './produzione/TabCanali'
import TabTrattamenti from './produzione/TabTrattamenti'
import TabTipoOspite from './produzione/TabTipoOspite'
import TabReportMensile from './produzione/TabReportMensile'
import TabRicaviCamere from './produzione/TabRicaviCamere'
import TabTest from './produzione/TabTest'
import { isAdmin, LS_TAB, LS_LORDO } from '../utils/produzioneHelpers'

const TABS_BASE = [
  { id: 'prod-import', label: 'Import' },
  { id: 'prod-giornaliera', label: 'Produzione giornaliera' },
  { id: 'prod-canali', label: 'Analisi canali' },
  { id: 'prod-trattamenti', label: 'Analisi trattamenti' },
  { id: 'prod-tipo-ospite', label: 'Analisi tipo ospite' },
  { id: 'prod-mensile', label: 'Report mensile' },
  { id: 'prod-ricavi-camere', label: 'Ricavi camere' },
]
const TABS_ADMIN = [...TABS_BASE, { id: 'prod-test', label: 'Dati di test' }]

// Tutte le tab di questo modulo mostrano il toggle IVA globale
const TAB_SENZA_TOGGLE_IVA = new Set(['prod-import', 'prod-test'])

export default function StatisticheProduzione() {
  const tabsDisponibili = isAdmin() ? TABS_ADMIN : TABS_BASE
  const [tab, setTab] = useState(() => localStorage.getItem(LS_TAB) || 'prod-giornaliera')
  const [lordo, setLordo] = useState(() => {
    const v = localStorage.getItem(LS_LORDO)
    return v === null ? true : v === 'true'
  })
  const [refreshKey, setRefreshKey] = useState(0)

  const cambiaTab = (id) => {
    setTab(id)
    localStorage.setItem(LS_TAB, id)
  }
  const cambiaLordo = (v) => {
    setLordo(v)
    localStorage.setItem(LS_LORDO, String(v))
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Statistiche Produzione</h1>

        {!TAB_SENZA_TOGGLE_IVA.has(tab) && (
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
        )}
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

      {tab === 'prod-import' && <TabImport onImportato={() => setRefreshKey(k => k + 1)} />}
      {tab === 'prod-giornaliera' && <TabGiornaliera lordo={lordo} key={refreshKey} />}
      {tab === 'prod-canali' && <TabCanali lordo={lordo} key={refreshKey} />}
      {tab === 'prod-trattamenti' && <TabTrattamenti lordo={lordo} key={refreshKey} />}
      {tab === 'prod-tipo-ospite' && <TabTipoOspite lordo={lordo} key={refreshKey} />}
      {tab === 'prod-mensile' && <TabReportMensile lordo={lordo} key={refreshKey} />}
      {tab === 'prod-ricavi-camere' && <TabRicaviCamere lordo={lordo} key={refreshKey} />}
      {tab === 'prod-test' && isAdmin() && <TabTest onPulito={() => setRefreshKey(k => k + 1)} />}
    </div>
  )
}
