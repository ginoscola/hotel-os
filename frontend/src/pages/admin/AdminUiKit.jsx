// Catalogo della libreria UI (components/ui + styles/tokens.js): riferimento visivo per
// costruire o migrare pagine. Solo dimostrativo, nessuna chiamata API.
import { useState } from 'react'
import {
  Button, PageHeader, SectionTitle, Card, Badge, Dot, HotelTag, Loading, StatoVuoto, Messaggio,
  Tabs, SegmentedControl, ToggleIva, Input, Select, Field, NavMese,
  Table, Th, Td, Modal, useConferma, useAvvisi, KpiTile, FileButton,
} from '../../components/ui'
import { colors, COLORI_STRUTTURA, fontSize } from '../../styles/tokens.js'
import { formatEuro } from '../../utils/format.js'

function Blocco({ titolo, children, nota }) {
  return (
    <Card title={titolo} style={{ marginBottom: 20 }}>
      {nota && <p className="ui-text-muted" style={{ marginTop: 0 }}>{nota}</p>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </Card>
  )
}

function Swatch({ nome, valore }) {
  return (
    <div style={{ width: 118 }}>
      <div style={{ height: 40, borderRadius: 6, background: valore, border: `1px solid ${colors.border}` }} />
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{nome}</div>
      <div className="ui-text-muted ui-num">{valore}</div>
    </div>
  )
}

export default function AdminUiKit() {
  const [tab, setTab] = useState('a')
  const [seg, setSeg] = useState('DPH')
  const [lordo, setLordo] = useState(true)
  const [periodo, setPeriodo] = useState({ anno: 2026, mese: 8 })
  const [modale, setModale] = useState(false)
  const conferma = useConferma()
  const avvisi = useAvvisi()

  const provaConferma = async (pericolo, ritardoMs) => {
    const ok = await conferma({
      titolo: pericolo ? 'Eliminare questo movimento?' : 'Confermare l\'operazione?',
      messaggio: pericolo ? 'L\'operazione non è reversibile.' : 'Esempio di conferma normale.',
      pericolo, ritardoMs,
    })
    avvisi.info(ok ? 'Hai confermato' : 'Hai annullato')
  }

  return (
    <div style={{ maxWidth: 1100 }}>
      <PageHeader title="Libreria UI" subtitle="components/ui · styles/tokens.js" />
      <Messaggio tipo="info">
        Riferimento per nuove pagine e per la migrazione di quelle esistenti. Importare da
        <code> components/ui</code>; i colori JS (grafici) da <code>styles/tokens.js</code>.
        Non usare colori esadecimali scritti a mano nelle pagine.
      </Messaggio>

      <Blocco titolo="Colori principali e grigi">
        <Swatch nome="primary" valore={colors.primary} />
        <Swatch nome="primarySoft" valore={colors.primarySoft} />
        <Swatch nome="text" valore={colors.text} />
        <Swatch nome="textSecond" valore={colors.textSecond} />
        <Swatch nome="textMuted" valore={colors.textMuted} />
        <Swatch nome="textSubtle" valore={colors.textSubtle} />
        <Swatch nome="border" valore={colors.border} />
        <Swatch nome="surfaceAlt" valore={colors.surfaceAlt} />
      </Blocco>

      <Blocco titolo="Colori di significato">
        <Swatch nome="success" valore={colors.success} />
        <Swatch nome="danger" valore={colors.danger} />
        <Swatch nome="warning" valore={colors.warning} />
        <Swatch nome="info" valore={colors.info} />
        <Swatch nome="iva (solo toggle IVA)" valore={colors.iva} />
      </Blocco>

      <Blocco titolo="Colori strutture" nota="Uguali in tutta l'app: coloreStruttura(code) / COLORI_STRUTTURA.">
        {Object.entries(COLORI_STRUTTURA).map(([k, v]) => <Swatch key={k} nome={k} valore={v} />)}
        <div style={{ display: 'flex', gap: 6 }}>
          {Object.keys(COLORI_STRUTTURA).map(k => <HotelTag key={k} code={k} />)}
        </div>
      </Blocco>

      <Blocco titolo="Scala testi">
        {Object.entries(fontSize).map(([k, v]) => (
          <span key={k} style={{ fontSize: v }}>{k} · {v}px</span>
        ))}
      </Blocco>

      <Blocco titolo="Pulsanti" nota="Un solo 'primary' per area. 'danger' solo dentro conferme; 'danger-soft' per Elimina in riga.">
        <Button>Salva</Button>
        <Button variant="secondary">Annulla</Button>
        <Button variant="danger">Elimina</Button>
        <Button variant="danger-soft" size="sm">Elimina</Button>
        <Button variant="ghost">Dettagli</Button>
        <Button size="sm">Piccolo</Button>
        <Button disabled>Disattivato</Button>
      </Blocco>

      <Card title="Tab" style={{ marginBottom: 20 }}>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'a', label: 'Conto Economico' }, { id: 'b', label: 'Movimenti Attivi' }, { id: 'c', label: 'Altro' }]} />
        <Tabs size="sm" value={tab} onChange={setTab} tabs={[{ id: 'a', label: 'Sotto-tab A' }, { id: 'b', label: 'Sotto-tab B' }]} />
      </Card>

      <Blocco titolo="Selezioni" nota="SegmentedControl per scelte esclusive; ToggleIva per IVA inclusa/esclusa; NavMese per ◀ mese ▶.">
        <SegmentedControl value={seg} onChange={setSeg}
          options={[{ value: 'DPH', label: 'Du Parc' }, { value: 'CLB', label: 'Club Hotel' }, { value: 'INT', label: 'International' }]} />
        <ToggleIva lordo={lordo} onChange={setLordo} />
        <NavMese anno={periodo.anno} mese={periodo.mese} onChange={setPeriodo} />
      </Blocco>

      <Blocco titolo="Campi">
        <Field label="Testo"><Input placeholder="Scrivi…" /></Field>
        <Field label="Modificato non salvato"><Input defaultValue="1.250,00" modificato /></Field>
        <Field label="Data"><Input type="date" defaultValue="2026-08-01" /></Field>
        <Field label="Scelta"><Select defaultValue="b"><option value="a">Opzione A</option><option value="b">Opzione B</option></Select></Field>
      </Blocco>

      <Card title="Riquadri KPI" style={{ marginBottom: 20 }}>
        <div className="ui-kpi-row" style={{ marginBottom: 0 }}>
          <KpiTile label="Budget Revenue" value={formatEuro(1250000)} />
          <KpiTile label="Scostamento €" value={formatEuro(42300)} colore={colors.success} />
          <KpiTile label="Scostamento %" value="-3,2%" colore={colors.danger} />
          <KpiTile label="Cam. Vend. Budget" value="12.450" sub="→ 12.980" />
          <KpiTile label="Principale (size lg)" value={formatEuro(3400000)} size="lg" />
        </div>
      </Card>

      <Blocco titolo="Caricamento file">
        <FileButton accept=".xlsx" onFile={f => avvisi.info(`Scelto: ${f.name}`)}>Importa da Excel</FileButton>
      </Blocco>

      <Blocco titolo="Badge e pallini">
        <Badge>NEUTRO</Badge><Badge tono="info">AUTO</Badge><Badge tono="ok">OK</Badge>
        <Badge tono="warn">ATTENZIONE</Badge><Badge tono="err">ERRORE</Badge>
        <span><Dot colore={colors.success} /> In range</span>
        <span><Dot colore={colors.warning} /> Sotto range</span>
        <span><Dot colore={colors.danger} /> Fuori range</span>
      </Blocco>

      <Card title="Messaggi inline" style={{ marginBottom: 20 }}>
        <Messaggio tipo="err" onChiudi={() => {}}>Errore nel caricamento dati.</Messaggio>
        <Messaggio tipo="ok">Import completato.</Messaggio>
        <Messaggio tipo="warn">3 righe fuori stagione.</Messaggio>
        <Messaggio tipo="info">Le righe AUTO sono calcolate dal sistema.</Messaggio>
      </Card>

      <Blocco titolo="Conferme e avvisi" nota="useConferma() al posto di window.confirm(), useAvvisi() al posto di alert().">
        <Button variant="secondary" onClick={() => provaConferma(false, 0)}>Conferma normale</Button>
        <Button variant="secondary" onClick={() => provaConferma(true, 0)}>Conferma eliminazione</Button>
        <Button variant="secondary" onClick={() => provaConferma(true, 2000)}>Con ritardo 2s (es. Chiusura Z)</Button>
        <Button variant="secondary" onClick={() => avvisi.successo('Valori salvati')}>Avviso successo</Button>
        <Button variant="secondary" onClick={() => avvisi.errore('Errore export: file non generato')}>Avviso errore</Button>
        <Button variant="secondary" onClick={() => setModale(true)}>Modale generica</Button>
      </Blocco>

      <Card title="Tabella" style={{ marginBottom: 20 }}>
        <Table>
          <thead>
            <tr><Th>Voce</Th><Th num>Du Parc</Th><Th num>Club Hotel</Th><Th num tot>Totale</Th></tr>
          </thead>
          <tbody>
            <tr><Td>Ricavi camere</Td><Td num>{formatEuro(125430.5)}</Td><Td num>{formatEuro(98210)}</Td><Td num tot>{formatEuro(223640.5)}</Td></tr>
            <tr><Td>Ricavi ristorante</Td><Td num>{formatEuro(40210)}</Td><Td num>{formatEuro(31022.4)}</Td><Td num tot>{formatEuro(71232.4)}</Td></tr>
            <tr><Td>Extra</Td><Td num muted>—</Td><Td num>{formatEuro(1200)}</Td><Td num tot>{formatEuro(1200)}</Td></tr>
            <tr className="ui-riga-attenuata"><Td>Dati assenti (ui-riga-attenuata)</Td><Td num>—</Td><Td num>—</Td><Td num tot>—</Td></tr>
            <tr className="ui-riga-avviso"><Td>Da compilare (ui-riga-avviso)</Td><Td num>{formatEuro(0)}</Td><Td num>{formatEuro(0)}</Td><Td num tot>{formatEuro(0)}</Td></tr>
            <tr className="ui-riga-ok"><Td>Completata (ui-riga-ok)</Td><Td num>{formatEuro(1000)}</Td><Td num>{formatEuro(900)}</Td><Td num tot>{formatEuro(1900)}</Td></tr>
            <tr className="ui-riga-subtotale"><Td>Subtotale (ui-riga-subtotale)</Td><Td num>{formatEuro(165640.5)}</Td><Td num>{formatEuro(130432.4)}</Td><Td num tot>{formatEuro(296072.9)}</Td></tr>
            <tr className="ui-riga-sezione"><Td>Totale sezione (ui-riga-sezione)</Td><Td num>{formatEuro(165640.5)}</Td><Td num>{formatEuro(130432.4)}</Td><Td num tot>{formatEuro(296072.9)}</Td></tr>
            <tr className="ui-riga-risultato"><Td>Risultato (ui-riga-risultato)</Td><Td num>{formatEuro(52000)}</Td><Td num>{formatEuro(41000)}</Td><Td num tot>{formatEuro(93000)}</Td></tr>
            <tr className="ui-riga-totale"><Td>TOTALE (ui-riga-totale)</Td><Td num>{formatEuro(165640.5)}</Td><Td num>{formatEuro(130432.4)}</Td><Td num tot>{formatEuro(296072.9)}</Td></tr>
          </tbody>
        </Table>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <Card title="Caricamento"><Loading /></Card>
        <Card title="Stato vuoto"><StatoVuoto /></Card>
      </div>

      <SectionTitle style={{ marginTop: 24 }}>SectionTitle (titolo di sezione)</SectionTitle>

      {modale && (
        <Modal titolo="Modale generica" onChiudi={() => setModale(false)}
          footer={<><Button variant="secondary" onClick={() => setModale(false)}>Chiudi</Button><Button onClick={() => setModale(false)}>Salva</Button></>}>
          Contenuto della modale: form, dettagli, ecc.
        </Modal>
      )}
    </div>
  )
}
