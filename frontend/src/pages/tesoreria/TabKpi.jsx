// KPI di tesoreria: andamento del saldo delle banche (anno vs anno precedente), punto più basso e uso
// del fido, mesi di autonomia, costo degli incassi, peso delle uscite sugli incassi, tassa di
// soggiorno incassata (Corrispettivi) e versata (banca).
import { useEffect, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../../api/client.js'
import { STILE_CONFRONTO, colors, coloreSerie } from '../../styles/tokens.js'
import { formatDataIt, formatEuro, formatEuroIntero, formatPerc, mostraErrore } from '../../utils/format.js'
import {
  Card, KpiTile, Loading, Messaggio, NavAnno, StatoVuoto, Table, Td, Th,
} from '../../components/ui'
import { BadgeCategoria, Importo } from './helpers.jsx'

const COLORE_SALDO = colors.info
// Anno precedente in un colore diverso (scelta dell'utente), tratteggiato come ogni serie di confronto
const COLORE_SALDO_AP = coloreSerie(1)
const legendaNeutra = v => <span style={{ color: colors.text }}>{v}</span>

function DeltaPunti({ v }) {
  // per le uscite un peso che sale è un peggioramento: rosso se positivo
  if (v == null) return <span style={{ color: colors.textSubtle }}>—</span>
  const colore = v > 0 ? colors.danger : v < 0 ? colors.success : undefined
  return <span className="ui-num" style={{ color: colore }}>{v > 0 ? '+' : ''}{v.toFixed(2)} pt</span>
}

export default function TabKpi() {
  const [anno, setAnno] = useState(new Date().getFullYear())
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    setDati(null)
    setErrore(null)
    api.get('/tesoreria/kpi', { params: { anno } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [anno])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <NavAnno anno={anno} onChange={setAnno} />
      </div>
      <Messaggio>{errore}</Messaggio>
      {!dati ? (!errore && <Loading />) : <Contenuto d={dati} />}
    </div>
  )
}

function Contenuto({ d }) {
  const a = d.autonomia
  const minimo = d.minimo.anno
  const minimoAp = d.minimo.ap_stesso_periodo
  const costo = d.costo_incassi
  const ts = d.tassa_soggiorno
  const periodo = `1 gen – ${formatDataIt(d.fino_al)}`

  return (
    <>
      <div className="ui-kpi-row">
        <KpiTile size="lg" label="Mesi di autonomia" value={a.mesi != null ? `${a.mesi.toFixed(1).replace('.', ',')} mesi` : '—'}
          sub={a.data_esaurimento ? `liquidità fino a ~${formatDataIt(a.data_esaurimento)}` : 'in inverno la cassa non cala'} />
        <KpiTile label={`Punto più basso ${d.anno}`} value={minimo ? formatEuro(minimo.saldo) : '—'}
          colore={minimo && minimo.saldo < 0 ? colors.danger : undefined}
          sub={minimo ? formatDataIt(minimo.data) : null}
          confronto={minimoAp ? `${formatEuro(minimoAp.saldo)} (${formatDataIt(minimoAp.data)})` : null}
          confrontoLabel="anno prec." />
        {d.fido.map(f => (
          <KpiTile key={f.conto_id} label={`Uso massimo fido — ${f.nome}`}
            value={f.anno.utilizzo_pct != null ? formatPerc(f.anno.utilizzo_pct) : '—'}
            colore={f.anno.utilizzo_pct > 50 ? colors.danger : undefined}
            sub={`${formatEuro(f.anno.utilizzo_massimo)} · ${f.anno.giorni_sotto_zero} giorni sotto zero`}
            confronto={f.ap.utilizzo_pct != null ? formatPerc(f.ap.utilizzo_pct) : null} confrontoLabel="anno prec." />
        ))}
        <KpiTile label="Commissioni POS su incassi POS" value={formatPerc(costo.anno.commissioni_pos_pct)}
          sub={formatEuro(costo.anno.commissioni_pos)}
          confronto={costo.ap.commissioni_pos_pct != null ? formatPerc(costo.ap.commissioni_pos_pct) : null}
          confrontoLabel="anno prec." />
        <KpiTile label="Tassa di soggiorno da versare" value={ts.disponibile ? formatEuro(ts.da_versare) : '—'}
          sub={ts.disponibile ? `incassata ${formatEuro(ts.incassata)} · versata ${formatEuro(ts.versata)}` : 'nessun dato Corrispettivi'} />
      </div>
      <p className="ui-text-muted">
        Autonomia: liquidità netta di oggi ({formatEuro(a.liquidita_netta)}) divisa per il consumo medio di cassa dei
        mesi senza stagione ({formatDataIt(a.inverno_da)} – {formatDataIt(a.inverno_a)}
        {a.consumo_mensile != null && <>: {formatEuro(a.consumo_mensile)} al mese</>}). È una stima dallo storico:
        con la previsione (Fase 3) diventerà il saldo previsto mese per mese.
        {!a.inverno_completo && ' Estratti conto incompleti per quel periodo: stima poco affidabile.'}
      </p>

      <Card title="Andamento del saldo delle banche">
        {d.andamento.length === 0 ? <StatoVuoto /> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={d.andamento} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="etichetta" tick={{ fontSize: 12, fill: colors.textMuted }} interval={29} />
              <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} width={52} tick={{ fontSize: 12, fill: colors.textMuted }} />
              <Tooltip formatter={(v, n) => [v == null ? '—' : formatEuroIntero(v), n]} />
              <Legend formatter={legendaNeutra} />
              <ReferenceLine y={0} stroke={colors.danger} strokeOpacity={0.5} />
              <Line dataKey="saldo" name={String(d.anno)} stroke={COLORE_SALDO} dot={false} strokeWidth={2} connectNulls={false} />
              <Line dataKey="saldo_ap" name={String(d.anno - 1)} stroke={COLORE_SALDO_AP} dot={false}
                {...STILE_CONFRONTO} strokeOpacity={1} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="ui-text-muted" style={{ marginTop: 8 }}>
          Somma dei conti correnti a fine giornata. La linea rossa è lo zero: sotto si sta usando il fido.
        </p>
      </Card>

      <Card title={`Peso delle uscite sugli incassi (${periodo})`}>
        {d.peso_uscite.length === 0 ? <StatoVuoto /> : (
          <Table compact>
            <thead>
              <tr>
                <Th>Categoria</Th><Th num>Uscite</Th><Th num tot>% sulle entrate</Th>
                <Th num>Anno prec.</Th><Th num>Variazione</Th>
              </tr>
            </thead>
            <tbody>
              {d.peso_uscite.map(p => (
                <tr key={p.categoria_id}>
                  <Td><BadgeCategoria nome={p.nome} colore={p.colore} /></Td>
                  <Td num>{formatEuro(p.uscite)}</Td>
                  <Td num tot>{p.pct != null ? formatPerc(p.pct) : '—'}</Td>
                  <Td num>{p.pct_ap != null ? formatPerc(p.pct_ap) : '—'}</Td>
                  <Td num><DeltaPunti v={p.delta_punti} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="ui-text-muted" style={{ marginTop: 8 }}>
          Uscite di ogni categoria in percentuale sulle entrate operative dello stesso periodo; anno precedente
          sullo stesso periodo. Sono dati di cassa: una rata pagata in un mese diverso sposta il confronto.
        </p>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        <Card title={`Costo degli incassi (${periodo})`}>
          <Table compact>
            <thead><tr><Th></Th><Th num>{d.anno}</Th><Th num>{d.anno - 1}</Th></tr></thead>
            <tbody>
              <tr><Td>Incassi POS e online</Td><Td num>{formatEuro(costo.anno.incassi_pos)}</Td><Td num>{formatEuro(costo.ap.incassi_pos)}</Td></tr>
              <tr><Td>Commissioni POS</Td><Td num>{formatEuro(costo.anno.commissioni_pos)}</Td><Td num>{formatEuro(costo.ap.commissioni_pos)}</Td></tr>
              <tr className="ui-riga-subtotale"><Td>% sugli incassi POS</Td>
                <Td num>{formatPerc(costo.anno.commissioni_pos_pct)}</Td><Td num>{formatPerc(costo.ap.commissioni_pos_pct)}</Td></tr>
              <tr><Td>Tutti i costi bancari</Td><Td num>{formatEuro(costo.anno.costi_banca)}</Td><Td num>{formatEuro(costo.ap.costi_banca)}</Td></tr>
              <tr className="ui-riga-subtotale"><Td>% sulle entrate operative</Td>
                <Td num>{formatPerc(costo.anno.costi_banca_pct)}</Td><Td num>{formatPerc(costo.ap.costi_banca_pct)}</Td></tr>
            </tbody>
          </Table>
          <p className="ui-text-muted" style={{ marginTop: 8 }}>
            Commissioni POS: addebiti mensili PagoBancomat e circuiti internazionali. Costi bancari: categoria
            «Banca» (commissioni, interessi, bolli, spese).
          </p>
        </Card>

        <Card title={`Tassa di soggiorno ${d.anno}`}>
          {!ts.disponibile ? <StatoVuoto>Nessun dato nei Corrispettivi per quest'anno.</StatoVuoto> : (
            <Table compact>
              <thead><tr><Th>Mese</Th><Th num>Incassata</Th><Th num>Versata</Th><Th num tot>Da versare</Th></tr></thead>
              <tbody>
                {ts.mesi.map(m => (
                  <tr key={m.mese}>
                    <Td>{m.etichetta}</Td>
                    <Td num>{formatEuro(m.incassata)}</Td>
                    <Td num>{m.versata ? formatEuro(m.versata) : '—'}</Td>
                    <Td num tot><Importo v={m.da_versare_cumulato} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="ui-text-muted" style={{ marginTop: 8 }}>
            Incassata dagli ospiti (Corrispettivi, per mese del documento) e versata al Comune (banca, per mese del
            bonifico). «Da versare» è il progressivo: si azzera quando il versamento del trimestre è fatto.
          </p>
        </Card>
      </div>
    </>
  )
}
