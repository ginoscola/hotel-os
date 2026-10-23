// Scheda "Food & Beverage" del modulo USALI: analisi per punto vendita (Colazione, Ristorante con
// pranzo/cena o ospiti/esterni del Mare Mosso, Bar, Buona Onda). Costi dalla contabilità importata,
// personale dai cedolini, ricavi da Produzione e corrispettivi — vedi services/usali_fnb.py.
import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { mostraErrore } from '../../utils/format.js'
import { Field, Loading, Messaggio, NavAnno, SegmentedControl, Select, Tabs } from '../../components/ui'
import { MESI_LUNGHI } from '../usaliContabile/helpers.jsx'
import RiepilogoFnb from './RiepilogoFnb.jsx'
import AndamentoFnb from './AndamentoFnb.jsx'
import CopertiFnb from './CopertiFnb.jsx'
import MateriaPrimaFnb from './MateriaPrimaFnb.jsx'

const LS_VISTA = 'usali_fnb_vista'
const LS_STRUTTURA = 'usali_fnb_struttura'

export const OPZIONI_STRUTTURA = [
  { value: 'DPH', label: 'Du Parc + Mare Mosso' },
  { value: 'CLB', label: 'Club Hotel' },
  { value: 'INT', label: 'International' },
  { value: 'BON', label: 'Buona Onda' },
  { value: 'GRUPPO', label: 'Gruppo' },
]

const VISTE = [
  { id: 'riepilogo', label: 'Riepilogo' },
  { id: 'andamento', label: 'Andamento mensile' },
  { id: 'coperti', label: 'Coperti' },
  { id: 'materia-prima', label: 'Materia prima' },
]

export default function UsaliFnb() {
  const [vista, setVista] = useState(() => localStorage.getItem(LS_VISTA) || 'riepilogo')
  const [struttura, setStruttura] = useState(() => {
    const v = localStorage.getItem(LS_STRUTTURA)
    return OPZIONI_STRUTTURA.some(o => o.value === v) ? v : 'DPH'
  })
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [meseDa, setMeseDa] = useState(1)
  const [meseA, setMeseA] = useState(12)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)
  const [versione, setVersione] = useState(0)   // ricarica dopo un inserimento coperti

  const usaReport = vista === 'riepilogo' || vista === 'andamento'

  useEffect(() => {
    if (!usaReport) return
    let annullato = false
    setLoading(true)
    setErrore(null)
    api.get('/usali/fnb/report', { params: { struttura, anno, mese_da: meseDa, mese_a: meseA } })
      .then(r => { if (!annullato) setReport(r.data) })
      .catch(e => { if (!annullato) { setReport(null); setErrore(mostraErrore(e)) } })
      .finally(() => { if (!annullato) setLoading(false) })
    return () => { annullato = true }
  }, [struttura, anno, meseDa, meseA, usaReport, versione])

  const cambiaVista = (id) => { setVista(id); localStorage.setItem(LS_VISTA, id) }
  const cambiaStruttura = (v) => { setStruttura(v); localStorage.setItem(LS_STRUTTURA, v) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {vista !== 'coperti' && (
          <SegmentedControl label="Struttura" options={OPZIONI_STRUTTURA} value={struttura} onChange={cambiaStruttura} />
        )}
        {/* Non <Field>: è un <label>, un clic sull'etichetta premerebbe il pulsante ◀ */}
        <div className="ui-field">
          <span className="ui-field-label">Anno</span>
          <NavAnno anno={anno} onChange={setAnno} />
        </div>
        {vista !== 'coperti' && (
          <>
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

      {usaReport && errore && <Messaggio>{errore}</Messaggio>}
      {usaReport && loading && !report && <Loading />}
      {vista === 'riepilogo' && report && <RiepilogoFnb report={report} />}
      {vista === 'andamento' && report && <AndamentoFnb report={report} />}
      {vista === 'coperti' && <CopertiFnb anno={anno} onSalvato={() => setVersione(v => v + 1)} />}
      {vista === 'materia-prima' && (
        <MateriaPrimaFnb struttura={struttura} anno={anno} meseDa={meseDa} meseA={meseA} />
      )}
    </div>
  )
}
