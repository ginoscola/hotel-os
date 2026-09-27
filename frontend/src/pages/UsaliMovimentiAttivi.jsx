import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { formatEuro, mostraErrore } from '../utils/format'
import { meseAnnoPrecedente, campoValore } from '../utils/produzioneHelpers'
import {
  Badge, Button, Input, Loading, Messaggio, NavMese, SegmentedControl, Table, Td, Th, ToggleIva, useAvvisi,
} from '../components/ui'

const LS_LORDO = 'usali_movimenti_lordo'

const STRUTTURE = [
  { code: 'DPH', label: 'Du Parc' },
  { code: 'CLB', label: 'Club Hotel' },
  { code: 'INT', label: 'International' },
  { code: 'BON', label: 'Buona Onda' },
]

const LS_STRUTTURA = 'usali_movimenti_struttura'

export default function UsaliMovimentiAttivi() {
  const def = meseAnnoPrecedente()
  const [struttura, setStruttura] = useState(() => localStorage.getItem(LS_STRUTTURA) || 'DPH')
  const [anno, setAnno] = useState(def.anno)
  const [mese, setMese] = useState(def.mese)
  const [righe, setRighe] = useState([])
  const [totaleImponibile, setTotaleImponibile] = useState(0)
  const [totaleLordo, setTotaleLordo] = useState(0)
  const [lordo, setLordo] = useState(() => localStorage.getItem(LS_LORDO) === 'true')
  const [loading, setLoading] = useState(false)
  const [modifiche, setModifiche] = useState({}) // riga_code → valore in edit
  const [salvando, setSalvando] = useState(false)
  const [errore, setErrore] = useState(null)
  const avvisi = useAvvisi()

  const cambiaStruttura = (sc) => {
    setStruttura(sc)
    localStorage.setItem(LS_STRUTTURA, sc)
  }

  const cambiaLordo = (v) => {
    setLordo(v)
    localStorage.setItem(LS_LORDO, String(v))
  }

  const carica = useCallback(async () => {
    setLoading(true)
    setModifiche({})
    setErrore(null)
    try {
      const { data } = await api.get('/usali/movimenti-attivi', { params: { struttura, anno, mese } })
      setRighe(data.righe)
      setTotaleImponibile(data.totale_imponibile)
      setTotaleLordo(data.totale_lordo)
    } catch (e) {
      setErrore(mostraErrore(e))
    } finally {
      setLoading(false)
    }
  }, [struttura, anno, mese])

  useEffect(() => { carica() }, [carica])

  const valoreVisualizzato = (r) => modifiche[r.riga_code] ?? String(r.imponibile)

  const confermaModifiche = async () => {
    const daSalvare = Object.entries(modifiche)
    if (daSalvare.length === 0) return
    setSalvando(true)
    try {
      for (const [riga_code, valore] of daSalvare) {
        const num = parseFloat(String(valore).replace(',', '.'))
        await api.put('/usali/movimenti-attivi', {
          struttura, anno, mese, riga_code, imponibile: isNaN(num) ? 0 : num,
        })
      }
      avvisi.successo('Valori salvati')
      carica()
    } catch (e) {
      avvisi.errore(mostraErrore(e))
    } finally {
      setSalvando(false)
    }
  }

  // Raggruppa per Reparto, preservando l'ordine di arrivo dal backend
  const gruppi = []
  for (const r of righe) {
    let g = gruppi.find(x => x.reparto === r.reparto)
    if (!g) { g = { reparto: r.reparto, righe: [] }; gruppi.push(g) }
    g.righe.push(r)
  }

  const nModifiche = Object.keys(modifiche).length

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <SegmentedControl
          value={struttura}
          onChange={cambiaStruttura}
          options={STRUTTURE.map(s => ({ value: s.code, label: s.label }))}
        />
        <NavMese anno={anno} mese={mese} onChange={({ anno: a, mese: m }) => { setAnno(a); setMese(m) }} />
        <div style={{ marginLeft: 'auto' }}>
          <ToggleIva lordo={lordo} onChange={cambiaLordo} />
        </div>
      </div>

      <p className="ui-text-muted" style={{ marginTop: 0, marginBottom: 16 }}>
        Le righe con badge <Badge tono="info">AUTO</Badge> sono calcolate da Produzione/Corrispettivi e non sono modificabili qui.
        Le altre sono da inserire a mano.
      </p>

      <Messaggio tipo="err" onChiudi={() => setErrore(null)}>{errore}</Messaggio>

      {loading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Reparto</Th>
              <Th>Conto</Th>
              <Th num>{lordo ? 'Lordo' : 'Imponibile'}</Th>
            </tr>
          </thead>
          <tbody>
            {gruppi.map(g => (
              g.righe.map((r, i) => (
                <tr key={r.riga_code}>
                  <Td style={{ fontWeight: i === 0 ? 600 : 400 }}>{i === 0 ? g.reparto : ''}</Td>
                  <Td>{r.conto}</Td>
                  <Td num>
                    {r.auto ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Badge tono="info">AUTO</Badge>
                        {formatEuro(campoValore(r, lordo))}
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {lordo && (
                          <span className="ui-text-muted">(imponibile — lordo {formatEuro(r.lordo)})</span>
                        )}
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          €
                          <Input
                            type="text" inputMode="decimal"
                            value={valoreVisualizzato(r)}
                            modificato={r.riga_code in modifiche}
                            onChange={e => setModifiche(prev => ({ ...prev, [r.riga_code]: e.target.value }))}
                            className="ui-num"
                            style={{ width: 100, padding: '3px 8px', textAlign: 'right', color: 'var(--color-danger)', fontWeight: 600 }}
                          />
                        </span>
                      </span>
                    )}
                  </Td>
                </tr>
              ))
            ))}
          </tbody>
        </Table>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
        <Button onClick={confermaModifiche} disabled={nModifiche === 0 || salvando}>
          {salvando ? 'Salvataggio…' : `Conferma${nModifiche ? ` (${nModifiche})` : ''}`}
        </Button>
        <div className="ui-num" style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>
          Totale {formatEuro(lordo ? totaleLordo : totaleImponibile)}
        </div>
      </div>
    </div>
  )
}
