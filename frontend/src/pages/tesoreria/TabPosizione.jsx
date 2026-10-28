// Posizione attuale: saldo banche, contanti (Cassa reale di Corrispettivi), prepagate, carte da
// addebitare, liquidità netta e disponibilità con fido; avvisi di freschezza dei dati.
import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { colors } from '../../styles/tokens.js'
import { formatData, formatDataIt, formatEuro, mostraErrore } from '../../utils/format.js'
import {
  Badge, Card, Dot, Field, Input, KpiTile, Loading, Messaggio, Table, Td, Th,
} from '../../components/ui'
import { ETICHETTE_TIPO_CONTO, Importo, oggiISO } from './helpers.jsx'

const TONO_AVVISO = { rosso: 'err', arancione: 'warn', info: 'info' }

export default function TabPosizione({ onVaiA }) {
  const [giorno, setGiorno] = useState(oggiISO())
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    setErrore(null)
    api.get('/tesoreria/posizione', { params: { giorno } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [giorno])

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const contantiSub = dati.contanti_data_riferimento
    ? `Cassa reale al ${formatDataIt(dati.contanti_data_riferimento)}`
    : 'Cassa reale non disponibile'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Field label="Situazione al">
          <Input type="date" value={giorno} max={oggiISO()} onChange={e => e.target.value && setGiorno(e.target.value)} />
        </Field>
      </div>

      {dati.avvisi.map((a, i) => (
        <Messaggio key={i} tipo={TONO_AVVISO[a.livello]}>
          {a.messaggio}
          {a.tipo === 'da_classificare' && onVaiA && (
            <> — <a href="#" onClick={e => { e.preventDefault(); onVaiA('movimenti', { daClassificare: true }) }}>vedi</a></>
          )}
        </Messaggio>
      ))}

      <div className="ui-kpi-row">
        <KpiTile label="Saldo banche" value={formatEuro(dati.saldo_banche)} />
        <KpiTile label="Contanti in cassa" value={formatEuro(dati.contanti)} sub={contantiSub} />
        <KpiTile label="Prepagate" value={formatEuro(dati.prepagate)} />
        <KpiTile label="Carte da addebitare" value={formatEuro(dati.carte_da_addebitare)}
          colore={dati.carte_da_addebitare < 0 ? colors.danger : undefined} />
        <KpiTile size="lg" label="Liquidità netta" value={formatEuro(dati.liquidita_netta)}
          colore={dati.liquidita_netta < 0 ? colors.danger : undefined} />
        <KpiTile size="lg" label="Disponibilità con fido" value={formatEuro(dati.disponibilita_con_fido)}
          sub={`di cui fidi ${formatEuro(dati.fidi)}`} />
      </div>

      <Card title="Dettaglio per conto">
        <Table compact>
          <thead>
            <tr>
              <Th>Conto</Th><Th>Tipo</Th><Th num>Saldo</Th><Th>Ultimo saldo noto</Th>
              <Th num>Fido</Th><Th>Scadenza fido</Th>
            </tr>
          </thead>
          <tbody>
            {dati.conti.map(c => (
              <tr key={c.id}>
                <Td><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Dot colore={c.colore || colors.textSubtle} />{c.nome}
                </span></Td>
                <Td muted>{ETICHETTE_TIPO_CONTO[c.tipo] || c.tipo}</Td>
                <Td num><Importo v={c.tipo === 'carta_credito' && c.saldo != null ? -c.saldo : c.saldo} /></Td>
                <Td muted>
                  {formatData(c.data_ultimo_saldo)}
                  {c.ha_import ? '' : ' (manuale)'}
                </Td>
                <Td num>{c.fido ? formatEuro(c.fido) : '—'}</Td>
                <Td>
                  {c.fido_scadenza ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {formatData(c.fido_scadenza)}
                      {!c.fido_conteggiato && <Badge tono="err">scaduto</Badge>}
                    </span>
                  ) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="ui-text-muted" style={{ marginTop: 8 }}>
          Banche: ultimo saldo dell'estratto conto più i movimenti successivi. Carte di credito: speso non
          ancora addebitato (in negativo). Contanti: Corrispettivi → Cassa. Il fido conta fino al giorno di
          scadenza compreso.
        </p>
      </Card>
    </div>
  )
}
