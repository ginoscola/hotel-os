// Costo per pasto: colazione di Du Parc, Club e International; pasto del ristorante di Club e
// International (stesso costo a pranzo e a cena: non separati, pranzi e cene solo informativi) e
// Mare Mosso quando ci sono i coperti Menu. Costo pieno = materia prima + personale (cedolini) +
// altri costi F&B, per pasto.
import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api from '../../api/client.js'
import TooltipConTotale from '../../components/TooltipConTotale.jsx'
import { formatEuro, formatN, formatPerc, mostraErrore } from '../../utils/format.js'
import { Badge, Card, KpiTile, Loading, Messaggio, Table, Td, Th } from '../../components/ui'
import { colors, coloreSerie } from '../../styles/tokens.js'
import { MESI_BREVI } from '../usaliContabile/helpers.jsx'

const NOME = { DPH: 'Du Parc', CLB: 'Club Hotel', INT: 'International' }
const NOME_PASTO = {
  colazione: 'Colazione', ristorante: 'Pasto (pranzo o cena)',
  ospiti: 'Ospiti Du Parc', esterni: 'Clienti esterni',
}
// Componenti del costo pieno per pasto (si sommano: barre impilate + tooltip con totale)
const COMPONENTI = [
  ['food_coperto', 'Cibo', coloreSerie(0)],
  ['beverage_coperto', 'Bevande', coloreSerie(3)],
  ['personale_coperto', 'Personale', coloreSerie(1)],
  ['altri_coperto', 'Altri costi', coloreSerie(2)],
]

const legendaNeutra = (valore) => <span style={{ color: colors.text }}>{valore}</span>
const euro = v => (v == null ? '—' : formatEuro(v))

function etichetta(r, conStruttura) {
  const pasto = r.struttura === 'DPH' && r.pasto === 'ristorante' ? 'Mare Mosso (totale)' : NOME_PASTO[r.pasto]
  return conStruttura ? `${NOME[r.struttura]} — ${pasto}` : NOME[r.struttura]
}

function Margine({ v }) {
  if (v == null) return '—'
  return <span style={{ color: v < 0 ? colors.danger : colors.success }}>{formatEuro(v)}</span>
}

const perc = v => (v == null ? '—' : formatPerc(v))
const num = v => (v == null ? '—' : formatN(v))

function Sezione({ titolo, righe, conStruttura, nota, conPasti = false, etichettaRicavo = 'Ricavo medio', intestazione }) {
  const classeRiga = (r) => (r.struttura === 'DPH' && r.pasto === 'ristorante' ? 'ui-riga-subtotale' : undefined)
  const grafico = righe
    .filter(r => r.periodo.costo_coperto != null)
    .map(r => ({ nome: etichetta(r, conStruttura), ...r.periodo }))
  const mesi = righe[0]?.mesi.map(m => m.mese) || []

  return (
    <Card title={titolo}>
      {intestazione}
      {grafico.length > 0 && (
        <ResponsiveContainer width="100%" height={Math.max(160, grafico.length * 44 + 60)}>
          <BarChart data={grafico} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 12, fill: colors.textMuted }} tickFormatter={v => `${v} €`} />
            <YAxis type="category" dataKey="nome" width={conStruttura ? 220 : 110}
              tick={{ fontSize: 12, fill: colors.text }} />
            <Tooltip content={<TooltipConTotale />} cursor={{ fill: colors.surfaceAlt }} />
            <Legend formatter={legendaNeutra} />
            {COMPONENTI.map(([k, label, colore]) => (
              <Bar key={k} dataKey={k} name={label} stackId="costo" fill={colore} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      <Table compact>
        <thead>
          <tr>
            <Th>{conStruttura ? 'Pasto' : 'Struttura'}</Th>
            <Th num>Pasti</Th>
            <Th num gruppo>Cibo</Th>
            <Th num>Bevande</Th>
            <Th num title="Cibo + bevande">Materia prima</Th>
            <Th num gruppo>Personale</Th>
            <Th num>Altri costi</Th>
            <Th num tot>Costo pieno</Th>
            <Th num gruppo title="Ricavo medio per pasto, sugli stessi mesi del costo">{etichettaRicavo}</Th>
            <Th num>Margine</Th>
            {conPasti && <>
              <Th num gruppo>di cui pranzi</Th>
              <Th num>di cui cene</Th>
              <Th num title="Pranzi addebitati / presenze ospiti">Pranzi / presenze</Th>
              <Th num title="Cene addebitate / presenze ospiti">Cene / presenze</Th>
            </>}
          </tr>
        </thead>
        <tbody>
          {righe.map(r => {
            const p = r.periodo
            return (
              <tr key={r.id} className={classeRiga(r)}>
                <Td style={{ whiteSpace: 'nowrap', paddingLeft: r.stima_costi ? 24 : 8 }}>
                  {etichetta(r, conStruttura)}
                  {r.stima_costi && <span style={{ marginLeft: 6 }}><Badge tono="info">stima</Badge></span>}
                </Td>
                <Td num>{p.coperti == null ? '—' : formatN(p.coperti)}</Td>
                <Td num gruppo>{euro(p.food_coperto)}</Td>
                <Td num>{euro(p.beverage_coperto)}</Td>
                <Td num>{euro(p.mp_coperto)}</Td>
                <Td num gruppo>{euro(p.personale_coperto)}</Td>
                <Td num>{euro(p.altri_coperto)}</Td>
                <Td num tot><strong>{euro(p.costo_coperto)}</strong></Td>
                <Td num gruppo>{euro(p.ricavo_coperto_cc)}</Td>
                <Td num><Margine v={p.margine_coperto} /></Td>
                {conPasti && <>
                  <Td num gruppo>{num(p.pranzi)}</Td>
                  <Td num>{num(p.cene)}</Td>
                  <Td num>{perc(p.pranzi_perc)}</Td>
                  <Td num>{perc(p.cene_perc)}</Td>
                </>}
              </tr>
            )
          })}
        </tbody>
      </Table>

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 13 }}>Costo pieno per pasto, mese per mese</div>
      <Table compact>
        <thead>
          <tr>
            <Th>{conStruttura ? 'Pasto' : 'Struttura'}</Th>
            {mesi.map(m => <Th key={m} num>{MESI_BREVI[m - 1]}</Th>)}
            <Th num tot>Periodo</Th>
          </tr>
        </thead>
        <tbody>
          {righe.map(r => (
            <tr key={r.id} className={classeRiga(r)}>
              <Td style={{ whiteSpace: 'nowrap', paddingLeft: r.stima_costi ? 24 : 8 }}>{etichetta(r, conStruttura)}</Td>
              {r.mesi.map(m => <Td key={m.mese} num>{euro(m.costo_coperto)}</Td>)}
              <Td num tot>{euro(r.periodo.costo_coperto)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {nota && <div style={{ marginTop: 8, fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>{nota}</div>}
    </Card>
  )
}

function RiquadriMareMosso({ righe }) {
  const per = (pasto) => righe.find(r => r.pasto === pasto)?.periodo || {}
  const tot = per('ristorante'), osp = per('ospiti'), est = per('esterni')
  return (
    <div className="ui-kpi-row" style={{ marginBottom: 12 }}>
      <KpiTile label="Coperti" value={num(tot.coperti)}
        sub={`ospiti Du Parc ${num(osp.coperti)} · esterni ${num(est.coperti)}`} />
      <KpiTile label="Scontrino medio" value={euro(tot.ricavo_coperto)}
        sub={`ospiti ${euro(osp.ricavo_coperto)} · esterni ${euro(est.ricavo_coperto)} (indicativi)`} />
      <KpiTile label="Costo pieno per coperto" value={euro(tot.costo_coperto)} />
      <KpiTile label="Margine per coperto" value={euro(tot.margine_coperto)}
        colore={tot.margine_coperto < 0 ? colors.danger : colors.success} />
    </div>
  )
}

export default function CostoPastoFnb({ anno, meseDa, meseA }) {
  const [dati, setDati] = useState(null)
  const [errore, setErrore] = useState(null)

  useEffect(() => {
    let annullato = false
    setErrore(null)
    api.get('/usali/fnb/costo-pasto', { params: { anno, mese_da: meseDa, mese_a: meseA } })
      .then(r => { if (!annullato) setDati(r.data) })
      .catch(e => { if (!annullato) { setDati(null); setErrore(mostraErrore(e)) } })
    return () => { annullato = true }
  }, [anno, meseDa, meseA])

  if (errore) return <Messaggio>{errore}</Messaggio>
  if (!dati) return <Loading />

  const colazioni = dati.righe.filter(r => r.gruppo === 'colazione')
  const ristoranti = dati.righe.filter(r => r.gruppo === 'ristorante' && r.struttura !== 'DPH')
  const mareMosso = dati.righe.filter(r => r.struttura === 'DPH' && r.gruppo === 'ristorante')
  const mmsDisponibile = mareMosso.some(r => r.periodo.coperti != null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Sezione titolo="Costo colazione" righe={colazioni} conStruttura={false}
        nota="Personale dei reparti Colazioni e Pasticceria (abbinamento modificabile in Admin → USALI → Food & Beverage). Pasti = colazioni addebitate in Welcome (trattamento + extra)." />
      <Sezione titolo="Costo pasto ristorante" righe={ristoranti} conStruttura conPasti
        nota="Pranzo e cena hanno lo stesso costo: la differenza di prezzo serve solo a rendere conveniente la pensione completa, quindi costo e margine sono per pasto, senza distinzione. Pranzi e cene sono indicati solo a titolo informativo. Pasti = quote pranzo/cena addebitate in Welcome, non i pasti serviti." />
      {mmsDisponibile ? (
        <Sezione titolo="Costo pasto Mare Mosso" righe={mareMosso} conStruttura
          etichettaRicavo="Scontrino medio" intestazione={<RiquadriMareMosso righe={mareMosso} />}
          nota="Pasti = coperti del gestionale Menu (ospiti Du Parc compresi). Scontrino medio = ricavi IVA esclusa / coperti. Ospiti ed esterni hanno lo stesso costo per pasto (costi ripartiti per numero di coperti). La divisione dello scontrino tra ospiti ed esterni è indicativa: per gli ospiti si contano solo le quote pranzo/cena di Welcome, mentre i ricavi comprendono anche i piatti alla carta addebitati in camera — chi ordina alla carta senza quota risulta tra gli esterni. Il dato affidabile è il totale." />
      ) : (
        <Messaggio tipo="info">
          Mare Mosso: per il costo per pasto servono i coperti del gestionale Menu, da inserire nella
          sotto-scheda Coperti.
        </Messaggio>
      )}
      <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>
        Costo pieno = (materia prima + personale + altri costi F&B) / pasti, sui mesi con contabilità
        importata. Comprende anche i costi dei mesi senza vendite (acquisti, attrezzature e personale
        prima dell'apertura o dopo la chiusura); sono esclusi solo i mesi con vendite ma senza pasti
        registrati. I costi sono acquisti: non tengono conto della merce rimasta in magazzino.
      </div>
    </div>
  )
}
