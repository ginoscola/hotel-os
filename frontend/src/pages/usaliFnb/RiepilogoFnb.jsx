// Riepilogo F&B per punto vendita: KPI di periodo (sempre sui totali, mai medie dei mesi).
// Le sotto-righe pranzo/cena e ospiti/esterni hanno ricavi e coperti veri, costi stimati.
import { useState } from 'react'
import { formatEuroIntero, formatPerc, mostraErrore } from '../../utils/format.js'
import { Badge, Button, Card, KpiTile, Messaggio, Table, Td, Th, useAvvisi } from '../../components/ui'
import { colors } from '../../styles/tokens.js'
import { MESI_BREVI, scarica } from '../usaliContabile/helpers.jsx'
import { COLONNE } from './colonne.jsx'

const CLASSE = { totale: 'ui-riga-totale', punto: 'ui-riga-subtotale' }

export default function RiepilogoFnb({ report }) {
  const tot = report.righe[0].periodo
  const senzaContab = report.mesi_senza_contabilita.filter(m => m >= report.mese_da && m <= report.mese_a)
  const [esportando, setEsportando] = useState(false)
  const avvisi = useAvvisi()

  async function esporta() {
    const { struttura, anno, mese_da, mese_a } = report
    setEsportando(true)
    try {
      await scarica('/usali/fnb/report/export', { struttura, anno, mese_da, mese_a },
        `FnB_${struttura}_${anno}_${String(mese_da).padStart(2, '0')}-${String(mese_a).padStart(2, '0')}.xlsx`)
    } catch (e) {
      avvisi.errore(mostraErrore(e, 'Errore durante l\'export'))
    } finally {
      setEsportando(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {report.avvisi.length > 0 && (
        <Messaggio tipo="warn">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Da verificare</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {report.avvisi.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Messaggio>
      )}

      <div className="ui-kpi-row">
        <KpiTile label="Ricavi F&B" value={formatEuroIntero(tot.ricavi)}
          sub={tot.ricavi_contabili != null ? `contabilità ${formatEuroIntero(tot.ricavi_contabili)}` : null} />
        <KpiTile label="Materia prima" value={tot.materia_prima_perc == null ? '—' : formatPerc(tot.materia_prima_perc)}
          sub={tot.materia_prima != null ? formatEuroIntero(tot.materia_prima) : null} />
        <KpiTile label="Personale" value={tot.personale == null ? '—' : formatEuroIntero(tot.personale)}
          sub={tot.personale_contabile != null ? `contabilità ${formatEuroIntero(tot.personale_contabile)}` : null} />
        <KpiTile label="Prime cost" value={tot.prime_cost_perc == null ? '—' : formatPerc(tot.prime_cost_perc)}
          sub="materia prima + personale" />
        <KpiTile label="Margine F&B" value={tot.margine == null ? '—' : formatEuroIntero(tot.margine)}
          colore={tot.margine < 0 ? colors.danger : undefined}
          sub={tot.margine_perc != null ? `${formatPerc(tot.margine_perc)} dei ricavi` : null} />
      </div>

      <Card title="Per punto vendita" actions={
        <Button size="sm" variant="secondary" onClick={esporta} disabled={esportando}>
          {esportando ? '…' : '⬇ Esporta Excel'}
        </Button>
      }>
        <Table compact maxHeight="70vh">
          <thead>
            <tr>
              <Th style={{ minWidth: 200 }}>Punto vendita</Th>
              {COLONNE.map(([k, label, , gruppo, descr]) => (
                <Th key={k} num gruppo={gruppo} title={descr}>{label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.righe.map(r => {
              const scuro = r.tipo === 'totale'
              return (
                <tr key={r.id} className={CLASSE[r.tipo]}>
                  <Td style={{ paddingLeft: r.tipo === 'sub' ? 28 : 8, whiteSpace: 'nowrap',
                    fontStyle: r.tipo === 'sub' ? 'italic' : undefined }}>
                    {r.label}
                    {r.stima_costi && (
                      <span style={{ marginLeft: 6 }}>
                        <Badge tono="info" title="Costi stimati: la contabilità non separa questa voce, ripartiti sui coperti pesati">stima</Badge>
                      </span>
                    )}
                  </Td>
                  {COLONNE.map(([k, , render, gruppo]) => (
                    <Td key={k} num gruppo={gruppo}>{render(r.periodo[k], scuro)}</Td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </Table>
        <div style={{ marginTop: 8, fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>
          Costi = acquisti registrati in contabilità (nessuna variazione di magazzino): sul singolo mese
          le percentuali oscillano, sulla stagione sono affidabili. Rapporti calcolati solo sui mesi con
          contabilità importata{senzaContab.length > 0 && <> (esclusi: {senzaContab.map(m => MESI_BREVI[m - 1]).join(', ')})</>}.
          Costi di pranzo/cena e ospiti/esterni stimati con una cena = {String(report.peso_cena).replace('.', ',')} pranzi
          (Admin → USALI → Food & Beverage). Coperti = pasti addebitati in Welcome, non serviti;
          per Buona Onda sono gli scontrini.
        </div>
      </Card>
    </div>
  )
}
