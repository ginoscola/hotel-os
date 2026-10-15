// Scheda "Conto Economico contabile" del modulo USALI: conto economico dall'export del
// gestionale (già riclassificato USALI), distinto dal "Conto Economico" interno della prima scheda.
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { Field, Messaggio, NavAnno, SegmentedControl, Select, Tabs } from '../../components/ui'
import { MESI_LUNGHI } from './helpers.jsx'
import TabellaCE from './TabellaCE.jsx'
import KpiCE from './KpiCE.jsx'
import ImportCE from './ImportCE.jsx'

const LS_VISTA = 'usali_contabile_vista'
const LS_STRUTTURA = 'usali_contabile_struttura'

const VISTE = [
  { id: 'ce', label: 'Conto economico' },
  { id: 'kpi', label: 'KPI' },
  { id: 'import', label: 'Import e storico' },
]

export default function UsaliContabile() {
  const [vista, setVista] = useState(() => localStorage.getItem(LS_VISTA) || 'ce')
  const [strutture, setStrutture] = useState([])
  const [struttura, setStruttura] = useState(() => localStorage.getItem(LS_STRUTTURA) || 'DPH')
  const [segmenti, setSegmenti] = useState([])
  const [segmentoId, setSegmentoId] = useState('')
  const [periodi, setPeriodi] = useState(null)
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [meseDa, setMeseDa] = useState(1)
  const [meseA, setMeseA] = useState(12)
  const [versione, setVersione] = useState(0)   // ricarica dopo un import
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    api.get('/usali/contabile/strutture')
      .then(r => setStrutture(r.data))
      .catch(e => setErrore(mostraErrore(e)))
  }, [versione])

  // Cambio struttura (o nuovo import): segmenti, periodi disponibili e periodo di default
  // = anno più recente importato, da gennaio all'ultimo mese importato.
  useEffect(() => {
    let annullato = false
    Promise.all([
      api.get('/usali/contabile/segmenti', { params: { struttura } }),
      api.get('/usali/contabile/periodi', { params: { struttura } }),
    ]).then(([s, p]) => {
      if (annullato) return
      setSegmenti(s.data)
      setSegmentoId(prev => (s.data.some(x => String(x.id) === String(prev)) ? prev : ''))
      setPeriodi(p.data)
      if (p.data.length) {
        setAnno(p.data[0].anno)
        setMeseDa(1)
        setMeseA(Math.max(...p.data[0].mesi))
      }
    }).catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [struttura, versione])

  const cambiaVista = (id) => { setVista(id); localStorage.setItem(LS_VISTA, id) }
  const cambiaStruttura = (code) => { setStruttura(code); localStorage.setItem(LS_STRUTTURA, code) }
  const cambiaAnno = (a) => {
    setAnno(a)
    const p = periodi?.find(x => x.anno === a)
    if (p) { setMeseDa(1); setMeseA(Math.max(...p.mesi)) }
  }
  const dopoImport = useCallback(() => setVersione(v => v + 1), [])

  const opzioniStruttura = strutture
    .filter(s => s.ha_dati || s.code === struttura || s.id_gestionale.length)
    .map(s => ({ value: s.code, label: s.nome }))

  const filtri = { struttura, segmentoId: segmentoId ? Number(segmentoId) : null, anno, meseDa, meseA }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {errore && <Messaggio onChiudi={() => setErrore(null)}>{errore}</Messaggio>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {opzioniStruttura.length > 0 && (
          <SegmentedControl label="Struttura" options={opzioniStruttura} value={struttura} onChange={cambiaStruttura} />
        )}
        {vista !== 'import' && (
          <>
            <Field label="Segmento">
              <Select value={segmentoId} onChange={e => setSegmentoId(e.target.value)}>
                <option value="">Tutta la struttura</option>
                {segmenti.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </Select>
            </Field>
            {/* Non <Field>: è un <label>, un clic sull'etichetta premerebbe il pulsante ◀ */}
            <div className="ui-field">
              <span className="ui-field-label">Anno</span>
              <NavAnno anno={anno} onChange={cambiaAnno} />
            </div>
            <Field label="Da">
              <Select value={meseDa} onChange={e => {
                const v = Number(e.target.value); setMeseDa(v); if (v > meseA) setMeseA(v)
              }}>
                {MESI_LUNGHI.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
            <Field label="A">
              <Select value={meseA} onChange={e => {
                const v = Number(e.target.value); setMeseA(v); if (v < meseDa) setMeseDa(v)
              }}>
                {MESI_LUNGHI.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </Select>
            </Field>
          </>
        )}
      </div>

      <Tabs tabs={VISTE} value={vista} onChange={cambiaVista} size="sm" />

      {vista === 'ce' && <TabellaCE key={versione} {...filtri} />}
      {vista === 'kpi' && <KpiCE key={versione} {...filtri} />}
      {vista === 'import' && <ImportCE struttura={struttura} strutture={strutture} onImportato={dopoImport} />}
    </div>
  )
}
