import { useState, useEffect } from 'react'
import TabAnalisiRicavi from './TabAnalisiRicavi'
import TabStampanteRT from './TabStampanteRT'
import TabControlloRT from './TabControlloRT'
import TabImport from './TabImport'
import TabDocumenti from './TabDocumenti'
import TabPenali from './TabPenali'
import TabGiornalieri from './TabGiornalieri'
import TabTest from './TabTest'
import TabFatturati from './TabFatturati'
import TabCassa from './TabCassa'
import api from '../api/client'
import { isAdmin } from '../utils/corrispettiviHelpers'
import { PageHeader, Tabs, ToggleIva } from '../components/ui'
import { colors } from '../styles/tokens.js'

// ─────────────────────────────────────────────────────────────────────────────

const LS_TAB = 'corrispettivi_tab'
const LS_LORDO = 'corrispettivi_lordo'

const TABS_BASE = [
  { id: 'import', label: 'Import' },
  { id: 'giornalieri', label: 'Corrispettivi giornalieri' },
  { id: 'scontrini', label: 'Scontrini' },
  { id: 'fatture', label: 'Fatture' },
  { id: 'penali', label: 'Penali' },
  { id: 'fatturati', label: 'Riepilogo Fatturati' },
  { id: 'cassa', label: 'Cassa' },
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
  const [tab, setTab] = useState(() => {
    const salvato = localStorage.getItem(LS_TAB)
    return TABS_ADMIN.some(t => t.id === salvato) ? salvato : 'giornalieri'
  })
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
      <PageHeader title="Corrispettivi">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <ToggleIva lordo={lordo} onChange={cambiaLordo} />
          {tab === 'analisi' && !lordo && (
            <span style={{ fontSize: 'var(--fs-sm)', color: colors.warningText }}>
              ⚠ Valori presunti: IVA complessiva stimata al 10%
            </span>
          )}
        </div>
      </PageHeader>

      <Tabs tabs={tabsDisponibili} value={tab} onChange={cambiaTab} />

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
      {tab === 'penali' && (
        <TabPenali key={`pen_${refreshKey}`} refreshKey={refreshKey} />
      )}
      {tab === 'fatturati' && (
        <TabFatturati lordo={lordo} />
      )}
      {tab === 'cassa' && (
        <TabCassa />
      )}
      {tab === 'rt' && (
        <TabControlloRT />
      )}
      {tab === 'rt-stampante' && (
        <TabStampanteRT isAdmin={isAdmin()} />
      )}
      {tab === 'analisi' && (
        <TabAnalisiRicavi hotels={hotels} isAdmin={isAdmin()} lordo={lordo} />
      )}
      {tab === 'test' && isAdmin() && (
        <TabTest onPulito={() => setRefreshKey(k => k + 1)} />
      )}
    </div>
  )
}
