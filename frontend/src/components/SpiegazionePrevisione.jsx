// Pulsante "Come funziona la previsione?" + finestra con la spiegazione dell'algoritmo della
// proiezione fine stagione (services/pickup_forecast.py). Usato nella tab Proiezione del Budget e
// in Admin → Budget → Previsione fine stagione. Se cambia l'algoritmo, aggiornare anche questo testo.
import { useState, useEffect } from 'react'
import api from '../api/client.js'
import { Badge, Button, Modal, Table, Td } from './ui'
import { colors } from '../styles/tokens.js'

const fmtPeso = (p) => p == null ? '—' : `${Math.round(p * 100)}% coefficiente, ${Math.round((1 - p) * 100)}% additivo`

function Parametri() {
  const [p, setP] = useState(null)
  useEffect(() => {
    api.get('/budget-previsione/parametri').then(r => setP(r.data.valori)).catch(() => setP(null))
  }, [])
  if (!p) return null
  return (
    <Table compact>
      <tbody>
        <tr><Td>Peso dei due metodi</Td><Td>{fmtPeso(p.peso_moltiplicativo)}</Td></tr>
        <tr><Td>Settimane di riferimento</Td><Td>la stessa dell'anno precedente ± {p.finestra_settimane}</Td></tr>
        <tr><Td>Tetto al coefficiente</Td><Td>{p.tetto_coefficiente ? `×${p.tetto_coefficiente}` : 'nessuno'}</Td></tr>
        <tr><Td>Peso degli anni</Td><Td>{(p.peso_anni || []).map((w, i) => `${i === 0 ? 'anno precedente' : `${i + 1} anni prima`} ${w}`).join(' · ')}</Td></tr>
        <tr><Td>Tolleranza sulla data delle snapshot</Td><Td>± {p.tolleranza_giorni} giorni</Td></tr>
      </tbody>
    </Table>
  )
}

export default function SpiegazionePrevisione({ variant = 'ghost', size = 'sm' }) {
  const [aperta, setAperta] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} onClick={() => setAperta(true)}>ⓘ Come funziona la previsione?</Button>
      {aperta && (
        <Modal titolo="Come funziona la previsione di fine stagione" onChiudi={() => setAperta(false)} larghezza={760}>
          <div style={{ fontSize: 'var(--fs-base)', lineHeight: 1.55 }}>
            <h4>In breve</h4>
            <p>
              La proiezione di fine stagione somma, settimana per settimana, quello che è già
              successo e quello che probabilmente succederà. Per le settimane ancora da vivere parte
              dal <strong>prenotato attuale (OTB)</strong> e aggiunge le <strong>vendite attese</strong>,
              stimate guardando come sono cresciute le prenotazioni l'anno scorso nelle stesse
              settimane, alla stessa distanza dall'arrivo.
            </p>

            <h4>Da dove viene il valore di ogni settimana</h4>
            <Table compact>
              <tbody>
                <tr><Td><Badge tono="ok">Consuntivo</Badge></Td><Td>Settimana già chiusa: dati Revenue definitivi.</Td></tr>
                <tr><Td><Badge tono="info">Previsione</Badge> <Badge tono="info">In corso</Badge></Td><Td>Prenotato + vendite attese, calcolate come sotto.</Td></tr>
                <tr><Td><Badge>OTB</Badge></Td><Td>Settimana in corso senza storico dell'anno precedente: solo il prenotato.</Td></tr>
                <tr><Td><Badge>Budget</Badge></Td><Td>Nessun import Revenue dell'anno o nessuno storico per quella settimana: si usa il budget.</Td></tr>
              </tbody>
            </Table>

            <h4>Come si stimano le vendite attese</h4>
            <ol style={{ paddingLeft: 20 }}>
              <li>Si prende la stessa settimana dell'anno precedente (sabato su sabato) e le settimane vicine.</li>
              <li>Per ognuna si guarda quanto era prenotato <em>alla stessa distanza dall'arrivo</em> di oggi e quanto si è chiuso alla fine.</li>
              <li>Si calcolano due stime:
                <ul>
                  <li><strong>coefficiente</strong> (moltiplicativo): "l'anno scorso il finale era 2 volte il prenotato" → prenotato di oggi × 2;</li>
                  <li><strong>pickup additivo</strong>: "l'anno scorso dopo quella data si sono venduti altri 10.000 €" → prenotato di oggi + 10.000 €.</li>
                </ul>
              </li>
              <li>La previsione è la media pesata delle due: il coefficiente segue il ritmo di quest'anno, l'additivo è più stabile quando il prenotato è ancora piccolo.</li>
              <li>Camere vendute, ricavi camere, F&B ed extra sono stimati separatamente; le camere non superano mai le disponibili.</li>
            </ol>
            <p style={{ background: colors.surfaceSoft, padding: '8px 12px', borderRadius: 6 }}>
              <strong>Esempio.</strong> Settimana di agosto, 4 settimane all'arrivo, prenotato 30.000 €.
              L'anno scorso alla stessa distanza c'erano 25.000 € e si è chiuso a 40.000 €
              (coefficiente ×1,6; pickup +15.000 €). Stime: 30.000 × 1,6 = 48.000 € e
              30.000 + 15.000 = 45.000 € → previsione <strong>46.500 €</strong>, di cui 16.500 € di vendite attese.
            </p>

            <h4>Il correttivo</h4>
            <p>
              Ogni stagione ha il suo andamento. Da Admin si può impostare un correttivo % per hotel,
              per stagione o per singolo mese: agisce <strong>solo sulle vendite attese</strong>, mai sul
              prenotato. Nell'esempio, con −20% le vendite attese passano da 16.500 a 13.200 € e la
              previsione a 43.200 €. Avvicinandosi alla data le vendite attese si riducono, quindi
              anche l'effetto del correttivo.
            </p>

            <h4>Parametri in uso</h4>
            <Parametri />

            <h4>Quanto è affidabile</h4>
            <p>
              Nella prova sulla stagione 2026 l'errore sul ricavo di stagione è stato dell'1–2,5% già
              da marzo, contro il 40–70% del solo prenotato. È una stima ottimistica (le differenze
              vere tra un anno e l'altro non c'erano); realisticamente ci si può aspettare 5–10% a inizio
              stagione, che si riduce man mano. Admin → Budget → Previsione fine stagione mostra
              quanto sta sbagliando l'algoritmo nella stagione in corso e suggerisce il correttivo.
            </p>
            <p className="ui-text-muted">
              Non vede eventi nuovi (una fiera, un gruppo perso, un cambio di prezzi): se li conosci,
              usa il correttivo.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
