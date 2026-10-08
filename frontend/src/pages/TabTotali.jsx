import { useState, useEffect } from 'react'
import api from '../api/client'
import { ExportMenu } from '../components/ExportMenu'
import { formatEuro, mostraErrore } from '../utils/format'
import {
  Card, Dot, Loading, Messaggio, NavAnno, SegmentedControl, StatoVuoto, Table, Th, Td,
} from '../components/ui'
import { colors, COLORI_STRUTTURA } from '../styles/tokens.js'

// Tab "Totali": totali mensili per struttura, scontrini (Stampanti RT) e fatture separati.
// Dati da /corrispettivi/report/totali, che riusa report_giornaliero: i valori coincidono
// con la somma dei giorni di "Corrispettivi giornalieri". IVA e tassa di soggiorno sono
// applicate lato server (stessi valori dell'export).

const LS_TS = 'corrispettivi_totali_con_ts'

const SEZIONI = [
  { chiave: 'scontrini', titolo: 'Scontrini (Stampanti RT)', etichettaTot: 'TOTALE SCONTRINI' },
  { chiave: 'fatture', titolo: 'Fatture', etichettaTot: 'TOTALE FATTURE' },
]

// Valore cella: zero → trattino tenue, come nel prospetto di riferimento
const Valore = ({ v, tot }) => (
  v ? <Td num tot={tot}>{formatEuro(v)}</Td> : <Td num tot={tot} muted>—</Td>
)

function TabellaSezione({ sezione, dati, mesi }) {
  return (
    <Table compact minWidth={760}>
      <thead>
        <tr>
          <Th style={{ minWidth: 170 }}>Struttura</Th>
          {mesi.map(m => <Th key={m.mese} num>{m.nome_mese}</Th>)}
          <Th num tot>TOTALE</Th>
        </tr>
      </thead>
      <tbody>
        {dati.righe.map(r => (
          <tr key={r.struttura_code}>
            <Td>
              <Dot colore={COLORI_STRUTTURA[r.struttura_code] || colors.textSubtle} />
              <span style={{ marginLeft: 6 }}>{r.nome}</span>
            </Td>
            {r.per_mese === null
              ? <>
                  {mesi.map(m => <Td key={m.mese} num muted>—</Td>)}
                  <Td num tot muted>—</Td>
                </>
              : <>
                  {mesi.map(m => <Valore key={m.mese} v={r.per_mese[String(m.mese)]} />)}
                  <Valore v={r.totale} tot />
                </>}
          </tr>
        ))}
        <tr className="ui-riga-totale">
          <Td>{sezione.etichettaTot}</Td>
          {mesi.map(m => <Td key={m.mese} num>{formatEuro(dati.totale_mese[String(m.mese)] || 0)}</Td>)}
          <Td num tot>{formatEuro(dati.totale)}</Td>
        </tr>
      </tbody>
    </Table>
  )
}

export default function TabTotali({ lordo }) {
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [conTs, setConTs] = useState(() => localStorage.getItem(LS_TS) !== 'false')
  const [dati, setDati] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    setLoading(true)
    setErrore(null)
    api.get('/corrispettivi/report/totali', { params: { anno, lordo, con_ts: conTs } })
      .then(r => setDati(r.data))
      .catch(e => setErrore(mostraErrore(e)))
      .finally(() => setLoading(false))
  }, [anno, lordo, conTs])

  const cambiaTs = (v) => {
    setConTs(v)
    localStorage.setItem(LS_TS, String(v))
  }

  const mesi = dati?.mesi || []
  const nota = `${lordo ? 'IVA inclusa' : 'IVA esclusa'} — tassa di soggiorno ${conTs ? 'inclusa' : 'esclusa'}`
  const urlExport = `/corrispettivi/export/totali?anno=${anno}&lordo=${lordo}&con_ts=${conTs}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <NavAnno anno={anno} onChange={setAnno} />
        <SegmentedControl label="Tassa di soggiorno" value={conTs} onChange={cambiaTs} options={[
          { value: true, label: 'Inclusa' },
          { value: false, label: 'Esclusa' },
        ]} />
        {mesi.length > 0 && (
          <div style={{ marginLeft: 'auto' }}>
            <ExportMenu url={urlExport} nome={`corrispettivi_totali_${anno}`} />
          </div>
        )}
      </div>

      {errore && <Messaggio tipo="err">{errore}</Messaggio>}
      {loading && !dati && <Loading />}

      {dati && mesi.length === 0 && <StatoVuoto>Nessun dato per l'anno {anno}.</StatoVuoto>}

      {dati && mesi.length > 0 && (
        <>
          {SEZIONI.map(sez => (
            <Card key={sez.chiave} title={sez.titolo} style={{ marginBottom: 20 }}>
              <TabellaSezione sezione={sez} dati={dati[sez.chiave]} mesi={mesi} />
            </Card>
          ))}
          <Table compact>
            <tbody>
              <tr className="ui-riga-totale">
                <Td>TOTALE GENERALE (scontrini + fatture)</Td>
                <Td num style={{ fontWeight: 700 }}>{formatEuro(dati.totale_generale)}</Td>
              </tr>
            </tbody>
          </Table>
          <p className="ui-text-muted" style={{ marginTop: 8 }}>
            Valori: {nota}. Stessa fonte di "Corrispettivi giornalieri" (documenti annullati inclusi,
            come lì); Maremosso e Buona Onda da incassi inseriti a mano, nessuna fattura.
          </p>
        </>
      )}
    </div>
  )
}
