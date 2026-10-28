// Consuntivo: dove sono andati i soldi in un periodo. KPI operativi con anno precedente, tabella
// per categoria (clic → movimenti nel Drawer), grafico mensile del netto operativo.
import { useEffect, useMemo, useState } from 'react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import api from '../../api/client.js'
import { STILE_CONFRONTO, colors } from '../../styles/tokens.js'
import { formatData, formatEuro, formatEuroIntero, mostraErrore } from '../../utils/format.js'
import {
  Button, Card, Drawer, Field, Input, KpiTile, Loading, Messaggio, Paginazione, Select, StatoVuoto, Table, Td, Th,
} from '../../components/ui'
import { BadgeCategoria, Importo, isoLocale, oggiISO } from './helpers.jsx'

const LS_CONTO = 'tesoreria_consuntivo_conto'
const COLORE_NETTO = colors.info
const PER_PAGINA_DRAWER = 50

const legendaNeutra = v => <span style={{ color: colors.text }}>{v}</span>

function preset(tipo) {
  const oggi = new Date()
  const a = oggi.getFullYear()
  if (tipo === 'mese_prec') {
    return [isoLocale(new Date(a, oggi.getMonth() - 1, 1)), isoLocale(new Date(a, oggi.getMonth(), 0))]
  }
  if (tipo === 'anno_prec') return [`${a - 1}-01-01`, `${a - 1}-12-31`]
  return [`${a}-01-01`, oggiISO()]   // da inizio anno
}

function DrawerMovimenti({ riga, filtri, onChiudi }) {
  const [pagina, setPagina] = useState(1)
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    api.get('/tesoreria/movimenti', {
      params: { ...filtri, categoria_id: riga.categoria_id, pagina, per_pagina: PER_PAGINA_DRAWER },
    }).then(r => setDati(r.data)).catch(e => setErrore(mostraErrore(e)))
  }, [riga, filtri, pagina])

  return (
    <Drawer titolo={riga.nome} sottotitolo={`${formatData(filtri.data_da)} – ${formatData(filtri.data_a)}`}
      onChiudi={onChiudi} larghezza={720}>
      <Messaggio>{errore}</Messaggio>
      {!dati ? <Loading /> : (
        <>
          <p className="ui-text-muted" style={{ marginBottom: 8 }}>
            {dati.totale} movimenti — entrate {formatEuro(dati.entrate)}, uscite {formatEuro(dati.uscite)},
            netto {formatEuro(dati.netto)}
          </p>
          <Table compact>
            <thead><tr><Th>Data</Th><Th>Descrizione</Th><Th num>Importo</Th></tr></thead>
            <tbody>
              {dati.righe.map(m => (
                <tr key={m.id} className={m.categoria_manuale ? 'ui-riga-modificata' : undefined}>
                  <Td style={{ whiteSpace: 'nowrap' }}>{formatData(m.data_contabile)}</Td>
                  <Td>{m.controparte ? <b>{m.controparte}</b> : null}<div className="ui-text-muted">{m.descrizione}</div></Td>
                  <Td num><Importo v={m.importo} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Paginazione pagina={pagina} perPagina={PER_PAGINA_DRAWER} totale={dati.totale} onChange={setPagina} />
        </>
      )}
    </Drawer>
  )
}

function Kpi({ label, k, size }) {
  // Δ% = (attuale − anno prec.) / |anno prec.|: per le uscite (negative) è positivo quando si spende
  // meno, quindi il verde/rosso del badge ha già il verso giusto.
  const delta = k.delta_pct
  return (
    <KpiTile size={size} label={label} value={formatEuro(k.valore)}
      colore={k.valore < 0 ? colors.danger : undefined}
      confronto={k.anno_precedente != null ? formatEuro(k.anno_precedente) : null}
      confrontoLabel="anno prec." delta={delta} />
  )
}

export default function TabConsuntivo({ conti }) {
  const [periodo, setPeriodo] = useState(() => preset('ytd'))
  const [contoId, setContoId] = useState(() => localStorage.getItem(LS_CONTO) || '')
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)
  const [aperta, setAperta] = useState(null)

  const filtri = useMemo(() => ({
    data_da: periodo[0], data_a: periodo[1], ...(contoId ? { conto_id: Number(contoId) } : {}),
  }), [periodo, contoId])

  useEffect(() => {
    if (!periodo[0] || !periodo[1] || periodo[0] > periodo[1]) return
    let annullato = false
    setErrore(null)
    api.get('/tesoreria/consuntivo', { params: filtri })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) setErrore(mostraErrore(e)) })
    return () => { annullato = true }
  }, [filtri, periodo])

  const cambiaConto = v => { setContoId(v); localStorage.setItem(LS_CONTO, v) }
  const bancari = conti.filter(c => c.tipo === 'conto')

  const operative = dati?.categorie.filter(r => r.operativa) || []
  const nonOperative = dati?.categorie.filter(r => !r.operativa) || []

  const rigaCategoria = r => (
    <tr key={r.categoria_id} style={{ cursor: 'pointer' }} onClick={() => setAperta(r)} title="Vedi i movimenti">
      <Td><BadgeCategoria nome={r.nome} colore={r.colore} /></Td>
      <Td num>{r.n}</Td>
      <Td num><Importo v={r.entrate || null} /></Td>
      <Td num><Importo v={r.uscite || null} /></Td>
      <Td num tot><Importo v={r.netto} forte /></Td>
      <Td num><Importo v={r.netto_ap} /></Td>
      <Td num><Importo v={r.delta} /></Td>
    </tr>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Field label="Dal"><Input type="date" value={periodo[0]} onChange={e => setPeriodo([e.target.value, periodo[1]])} /></Field>
        <Field label="Al"><Input type="date" value={periodo[1]} onChange={e => setPeriodo([periodo[0], e.target.value])} /></Field>
        <Button variant="secondary" size="sm" onClick={() => setPeriodo(preset('mese_prec'))}>Mese precedente</Button>
        <Button variant="secondary" size="sm" onClick={() => setPeriodo(preset('ytd'))}>Da inizio anno</Button>
        <Button variant="secondary" size="sm" onClick={() => setPeriodo(preset('anno_prec'))}>Anno precedente</Button>
        <Field label="Conto">
          <Select value={contoId} onChange={e => cambiaConto(e.target.value)}>
            <option value="">Tutti i conti</option>
            {bancari.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
        </Field>
      </div>

      <Messaggio>{errore}</Messaggio>
      {periodo[0] > periodo[1] && <Messaggio tipo="warn">La data finale precede quella iniziale.</Messaggio>}
      {!dati ? <Loading /> : (
        <>
          {!dati.ap_completo && (
            <Messaggio tipo="info">
              Confronto con l'anno precedente parziale: estratti conto disponibili dal {formatData(dati.copertura_dal)}.
            </Messaggio>
          )}
          {!dati.quadratura.ok && dati.quadratura.variazione_saldo != null && (
            <Messaggio tipo="warn">
              La variazione dei saldi ({formatEuro(dati.quadratura.variazione_saldo)}) non coincide con la somma
              dei movimenti ({formatEuro(dati.quadratura.spiegata_dai_movimenti)}): manca un estratto conto?
            </Messaggio>
          )}

          <div className="ui-kpi-row">
            <Kpi label="Entrate operative" k={dati.kpi.entrate} />
            <Kpi label="Uscite operative" k={dati.kpi.uscite} />
            <Kpi label="Netto operativo" k={dati.kpi.netto_operativo} size="lg" />
            <Kpi label="Saldo inizio periodo" k={dati.kpi.saldo_inizio} />
            <Kpi label="Saldo fine periodo" k={dati.kpi.saldo_fine} />
          </div>

          <Card title="Netto operativo per mese">
            {dati.mensile.length === 0 ? <StatoVuoto /> : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={dati.mensile} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
                  <XAxis dataKey="etichetta" tick={{ fontSize: 12, fill: colors.textMuted }} />
                  <YAxis tickFormatter={v => `${Math.round(v / 1000)}k`} width={52}
                    tick={{ fontSize: 12, fill: colors.textMuted }} />
                  <Tooltip formatter={(v, n) => [formatEuroIntero(v), n]} />
                  <Legend formatter={legendaNeutra} />
                  <ReferenceLine y={0} stroke={colors.borderStrong} />
                  <Bar dataKey="netto_operativo" name="Netto operativo" fill={COLORE_NETTO} radius={[4, 4, 0, 0]} />
                  <Line dataKey="netto_operativo_ap" name="Anno precedente" stroke={COLORE_NETTO} dot={false}
                    {...STILE_CONFRONTO} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card title="Per categoria">
            <Table compact>
              <thead>
                <tr>
                  <Th>Categoria</Th><Th num>Movimenti</Th><Th num>Entrate</Th><Th num>Uscite</Th>
                  <Th num tot>Netto</Th><Th num>Anno prec.</Th><Th num>Δ</Th>
                </tr>
              </thead>
              <tbody>
                {operative.map(rigaCategoria)}
                <tr className="ui-riga-subtotale">
                  <Td>Totale operativo</Td><Td num />
                  <Td num><Importo v={dati.kpi.entrate.valore} /></Td>
                  <Td num><Importo v={dati.kpi.uscite.valore} /></Td>
                  <Td num tot><Importo v={dati.kpi.netto_operativo.valore} forte /></Td>
                  <Td num><Importo v={dati.kpi.netto_operativo.anno_precedente} /></Td>
                  <Td num><Importo v={dati.kpi.netto_operativo.delta} /></Td>
                </tr>
                {nonOperative.length > 0 && (
                  <tr className="ui-riga-sezione"><Td colSpan={7}>Movimenti non operativi</Td></tr>
                )}
                {nonOperative.map(rigaCategoria)}
              </tbody>
            </Table>
            <p className="ui-text-muted" style={{ marginTop: 8 }}>
              Clic su una categoria per vedere i movimenti.
              {dati.giroconti_esclusi.n > 0 && <> Esclusi {dati.giroconti_esclusi.n} giroconti tra i conti
                (netto {formatEuro(dati.giroconti_esclusi.netto)}).</>}
            </p>
          </Card>
        </>
      )}

      {aperta && <DrawerMovimenti riga={aperta} filtri={filtri} onChiudi={() => setAperta(null)} />}
    </div>
  )
}
