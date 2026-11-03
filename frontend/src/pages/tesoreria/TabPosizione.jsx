// Posizione attuale: saldo banche, contanti (Cassa reale di Corrispettivi), prepagate, carte da
// addebitare, liquidità netta e disponibilità con fido; avvisi di freschezza dei dati.
import { useEffect, useState } from 'react'
import api from '../../api/client.js'
import { colors } from '../../styles/tokens.js'
import { formatData, formatDataIt, formatEuro, mostraErrore } from '../../utils/format.js'
import {
  Badge, Card, Dot, Field, HotelTag, Input, KpiTile, Loading, Messaggio, Table, Td, Th,
} from '../../components/ui'
import { ETICHETTE_TIPO_CONTO, Importo, MESI_BREVI, STRUTTURE, oggiISO } from './helpers.jsx'


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
          {a.tipo === 'caparre' && onVaiA && (
            <> — <a href="#" onClick={e => { e.preventDefault(); onVaiA('caparre') }}>completa</a></>
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

      {dati.caparre_future?.totale > 0 && (
        <Card title={`Caparre per soggiorni futuri: ${formatEuro(dati.caparre_future.totale)} (già nel saldo banche)`}>
          <Table compact>
            <thead>
              <tr>
                <Th>Arrivo</Th>
                {STRUTTURE.map(s => <Th key={s.code} num><HotelTag code={s.code} label={s.nome} /></Th>)}
                <Th num>Non indicata</Th><Th num tot>Totale</Th>
              </tr>
            </thead>
            <tbody>
              {dati.caparre_future.per_mese.map(r => (
                <tr key={`${r.anno}-${r.mese}`}>
                  <Td>{MESI_BREVI[r.mese - 1]} {r.anno}</Td>
                  {STRUTTURE.map(s => <Td key={s.code} num>{formatEuro(r.per_struttura[s.code])}</Td>)}
                  <Td num muted>{formatEuro(r.per_struttura[''])}</Td>
                  <Td num tot>{formatEuro(r.totale)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="ui-text-muted" style={{ marginTop: 8 }}>
            {dati.caparre_future.senza_periodo > 0 && <>Nel totale anche {formatEuro(dati.caparre_future.senza_periodo)} di
              caparre senza periodo, stimate sui mesi di arrivo ancora da venire. </>}
            Bonifici da clienti già incassati per soggiorni non ancora iniziati, per mese di arrivo.
            Sono soldi in cassa legati a un servizio ancora da dare. Dettaglio e confronto con l'anno prima nella scheda
            Caparre.
          </p>
        </Card>
      )}

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
                  {c.carta_stato ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      estratto {formatData(c.data_ultimo_saldo)} di {formatEuro(c.carta_importo_estratto)}
                      {c.carta_stato === 'addebitato' && <Badge tono="ok">addebitato il {formatData(c.carta_data_addebito)}</Badge>}
                      {c.carta_stato === 'da_addebitare' && <Badge tono="warn">da addebitare</Badge>}
                    </span>
                  ) : <>{formatData(c.data_ultimo_saldo)}{c.ha_import ? '' : ' (manuale)'}</>}
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
          Banche: ultimo saldo dell'estratto conto più i movimenti successivi. Carte di credito: totale
          dell'ultimo estratto finché la banca non lo addebita (in negativo), poi zero. Contanti: Corrispettivi → Cassa. Il fido conta fino al giorno di
          scadenza compreso.
        </p>
      </Card>
    </div>
  )
}
