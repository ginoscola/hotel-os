import { useState } from 'react'
import TabImport from './produzione/TabImport'
import TabGiornaliera from './produzione/TabGiornaliera'
import TabCanali from './produzione/TabCanali'
import TabTrattamenti from './produzione/TabTrattamenti'
import TabTipoOspite from './produzione/TabTipoOspite'
import TabReportMensile from './produzione/TabReportMensile'
import TabConteggioPasti from './produzione/TabConteggioPasti'
import TabRicaviCamere from './produzione/TabRicaviCamere'
import TabTest from './produzione/TabTest'
import { isAdmin, LS_TAB, LS_LORDO } from '../utils/produzioneHelpers'
import { PageHeader, Tabs, ToggleIva } from '../components/ui'

const TABS_BASE = [
  { id: 'prod-import', label: 'Import' },
  { id: 'prod-giornaliera', label: 'Produzione giornaliera' },
  { id: 'prod-canali', label: 'Analisi canali' },
  { id: 'prod-trattamenti', label: 'Analisi trattamenti' },
  { id: 'prod-tipo-ospite', label: 'Analisi tipo ospite' },
  { id: 'prod-mensile', label: 'Report mensile' },
  { id: 'prod-conteggio-pasti', label: 'Conteggio pasti' },
  { id: 'prod-ricavi-camere', label: 'Ricavi camere' },
]
const TABS_ADMIN = [...TABS_BASE, { id: 'prod-test', label: 'Dati di test' }]

// Tutte le tab di questo modulo mostrano il toggle IVA globale, tranne quelle che non
// mostrano importi (Import/Dati di test) o mostrano un conteggio, non un ricavo (Conteggio pasti)
const TAB_SENZA_TOGGLE_IVA = new Set(['prod-import', 'prod-test', 'prod-conteggio-pasti'])

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
    <div>
      <PageHeader title="Statistiche Produzione">
        {!TAB_SENZA_TOGGLE_IVA.has(tab) && <ToggleIva lordo={lordo} onChange={cambiaLordo} />}
      </PageHeader>

      <Tabs tabs={tabsDisponibili} value={tab} onChange={cambiaTab} />

      {tab === 'prod-import' && <TabImport onImportato={() => setRefreshKey(k => k + 1)} />}
      {tab === 'prod-giornaliera' && <TabGiornaliera lordo={lordo} key={refreshKey} />}
      {tab === 'prod-canali' && <TabCanali lordo={lordo} key={refreshKey} />}
      {tab === 'prod-trattamenti' && <TabTrattamenti lordo={lordo} key={refreshKey} />}
      {tab === 'prod-tipo-ospite' && <TabTipoOspite lordo={lordo} key={refreshKey} />}
      {tab === 'prod-mensile' && <TabReportMensile lordo={lordo} key={refreshKey} />}
      {tab === 'prod-conteggio-pasti' && <TabConteggioPasti key={refreshKey} />}
      {tab === 'prod-ricavi-camere' && <TabRicaviCamere lordo={lordo} key={refreshKey} />}
      {tab === 'prod-test' && isAdmin() && <TabTest onPulito={() => setRefreshKey(k => k + 1)} />}
    </div>
  )
}
