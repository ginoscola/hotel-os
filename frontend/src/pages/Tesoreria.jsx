// Modulo Tesoreria — flusso di cassa di KM di Mare S.r.l.: posizione attuale, consuntivo,
// movimenti bancari, scadenzario fornitori (Passcom ↔ banca), import di estratti conto e scadenzario.
// Configurazione in Admin → Tesoreria.
import { useState } from 'react'
import { PageHeader, Tabs } from '../components/ui'
import TabConsuntivo from './tesoreria/TabConsuntivo.jsx'
import TabImport from './tesoreria/TabImport.jsx'
import TabKpi from './tesoreria/TabKpi.jsx'
import TabMovimenti from './tesoreria/TabMovimenti.jsx'
import TabPosizione from './tesoreria/TabPosizione.jsx'
import TabScadenzario from './tesoreria/TabScadenzario.jsx'
import { permessiTesoreria, useAnagrafiche } from './tesoreria/helpers.jsx'

const LS_TAB = 'tesoreria_tab'

const TABS = [
  { id: 'posizione', label: 'Posizione' },
  { id: 'consuntivo', label: 'Consuntivo' },
  { id: 'kpi', label: 'KPI' },
  { id: 'movimenti', label: 'Movimenti' },
  { id: 'scadenzario', label: 'Scadenzario' },
  { id: 'import', label: 'Import e saldi' },
]

export default function Tesoreria() {
  const [tab, setTab] = useState(() => {
    const salvata = localStorage.getItem(LS_TAB)
    return TABS.some(t => t.id === salvata) ? salvata : 'posizione'
  })
  const [filtroMovimenti, setFiltroMovimenti] = useState(null)
  const [versione, setVersione] = useState(0)   // dati cambiati (import, saldi): le schede ricaricano
  const { conti, categorie, ricarica } = useAnagrafiche()
  const permessi = permessiTesoreria()

  const cambiaTab = (id) => {
    setTab(id)
    localStorage.setItem(LS_TAB, id)
  }
  const vaiA = (id, filtro) => { setFiltroMovimenti(filtro || null); cambiaTab(id) }
  const datiCambiati = () => { ricarica(); setVersione(v => v + 1) }

  return (
    <div>
      <PageHeader title="Tesoreria" subtitle="KM di Mare S.r.l. — flusso di cassa" />
      <Tabs tabs={TABS} value={tab} onChange={cambiaTab} />

      {tab === 'posizione' && <TabPosizione key={versione} onVaiA={vaiA} />}
      {tab === 'consuntivo' && <TabConsuntivo key={versione} conti={conti} />}
      {tab === 'kpi' && <TabKpi key={versione} />}
      {tab === 'movimenti' && (
        <TabMovimenti key={versione} conti={conti} categorie={categorie} permessi={permessi}
          filtroIniziale={filtroMovimenti} />
      )}
      {tab === 'scadenzario' && <TabScadenzario key={versione} permessi={permessi} onVaiA={vaiA} />}
      {tab === 'import' && <TabImport conti={conti} permessi={permessi} onCambio={datiCambiati} />}
    </div>
  )
}
