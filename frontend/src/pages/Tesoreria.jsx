// Modulo Tesoreria — flusso di cassa di KM di Mare S.r.l.: posizione attuale, consuntivo,
// movimenti bancari, scadenzario fornitori (Passcom ↔ banca), fatture ricevute dallo SDI, import di estratti conto,
// scadenzario e ZIP delle fatture.
// Configurazione in Admin → Tesoreria.
import { useState } from 'react'
import { PageHeader, SegmentedControl, Tabs } from '../components/ui'
import TabCaparre from './tesoreria/TabCaparre.jsx'
import TabConsuntivo from './tesoreria/TabConsuntivo.jsx'
import TabFatture from './tesoreria/TabFatture.jsx'
import TabImpegni from './tesoreria/TabImpegni.jsx'
import TabImport from './tesoreria/TabImport.jsx'
import TabKpi from './tesoreria/TabKpi.jsx'
import TabMovimenti from './tesoreria/TabMovimenti.jsx'
import TabPosizione from './tesoreria/TabPosizione.jsx'
import TabPrevisione from './tesoreria/TabPrevisione.jsx'
import TabScadenzario from './tesoreria/TabScadenzario.jsx'
import { LS_TIPO_ANNO, OPZIONI_TIPO_ANNO, permessiTesoreria, useAnagrafiche } from './tesoreria/helpers.jsx'
import { schedaRichiesta, useSchedaDaUrl } from '../hooks/useSchedaDaUrl.js'

const LS_TAB = 'tesoreria_tab'

const TABS = [
  { id: 'posizione', label: 'Posizione' },
  { id: 'consuntivo', label: 'Consuntivo' },
  { id: 'kpi', label: 'KPI' },
  { id: 'previsione', label: 'Previsione' },
  { id: 'impegni', label: 'Impegni' },
  { id: 'caparre', label: 'Caparre' },
  { id: 'movimenti', label: 'Movimenti' },
  { id: 'scadenzario', label: 'Scadenzario' },
  { id: 'fatture', label: 'Fatture' },
  { id: 'import', label: 'Import e saldi' },
]

export default function Tesoreria() {
  const [tab, setTab] = useState(() => {
    const daUrl = schedaRichiesta(TABS)
    if (daUrl) return daUrl
    const salvata = localStorage.getItem(LS_TAB)
    return TABS.some(t => t.id === salvata) ? salvata : 'posizione'
  })
  const [tipoAnno, setTipoAnno] = useState(() => {
    try { return localStorage.getItem(LS_TIPO_ANNO) === 'alberghiero' ? 'alberghiero' : 'solare' } catch { return 'solare' }
  })
  const [filtroMovimenti, setFiltroMovimenti] = useState(null)
  const [versione, setVersione] = useState(0)   // dati cambiati (import, saldi): le schede ricaricano
  const { conti, categorie, ricarica } = useAnagrafiche()
  const permessi = permessiTesoreria()

  const cambiaTab = (id) => {
    setTab(id)
    localStorage.setItem(LS_TAB, id)
  }
  useSchedaDaUrl(TABS, cambiaTab)
  const cambiaTipoAnno = v => {
    setTipoAnno(v)
    try { localStorage.setItem(LS_TIPO_ANNO, v) } catch { /* preferenza non salvata */ }
  }
  const vaiA = (id, filtro) => { setFiltroMovimenti(filtro || null); cambiaTab(id) }
  const datiCambiati = () => { ricarica(); setVersione(v => v + 1) }

  return (
    <div>
      <PageHeader title="Tesoreria" subtitle="KM di Mare S.r.l. — flusso di cassa">
        <SegmentedControl options={OPZIONI_TIPO_ANNO} value={tipoAnno} onChange={cambiaTipoAnno} />
      </PageHeader>
      <Tabs tabs={TABS} value={tab} onChange={cambiaTab} />

      {tab === 'posizione' && <TabPosizione key={versione} onVaiA={vaiA} />}
      {tab === 'consuntivo' && <TabConsuntivo key={`${versione}-${tipoAnno}`} conti={conti} tipoAnno={tipoAnno} />}
      {tab === 'kpi' && <TabKpi key={`${versione}-${tipoAnno}`} tipoAnno={tipoAnno} />}
      {tab === 'previsione' && <TabPrevisione key={versione} permessi={permessi} tipoAnno={tipoAnno} />}
      {tab === 'impegni' && <TabImpegni key={versione} permessi={permessi} />}
      {tab === 'caparre' && <TabCaparre key={versione} permessi={permessi} />}
      {tab === 'movimenti' && (
        <TabMovimenti key={versione} conti={conti} categorie={categorie} permessi={permessi} tipoAnno={tipoAnno}
          filtroIniziale={filtroMovimenti} />
      )}
      {tab === 'scadenzario' && <TabScadenzario key={versione} permessi={permessi} onVaiA={vaiA} />}
      {tab === 'fatture' && <TabFatture key={versione} permessi={permessi} onVaiA={vaiA} />}
      {tab === 'import' && <TabImport conti={conti} permessi={permessi} onCambio={datiCambiati} />}
    </div>
  )
}
