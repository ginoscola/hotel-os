// Pulsante "ⓘ" + finestra con la spiegazione dell'indice WAVE (services/wave.py, services/wave_hotel.py).
// Accanto al nome WAVE in ogni punto in cui compare. Se cambia il calcolo, aggiornare anche questo testo.
import { useState } from 'react'
import { Button, Modal } from './ui'

export const TOOLTIP_WAVE = 'WAVE: quanto stai incassando rispetto al tuo miglior risultato di sempre per lo stesso periodo.'

export default function SpiegazioneWave({ variant = 'ghost', size = 'sm', etichetta = 'ⓘ' }) {
  const [aperta, setAperta] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} title={TOOLTIP_WAVE}
        onClick={e => { e.stopPropagation(); setAperta(true) }}>{etichetta}</Button>
      {aperta && (
        <Modal titolo="WAVE — Weekly Achieved Value vs Excellence" onChiudi={() => setAperta(false)} larghezza={640}>
          <div style={{ fontSize: 'var(--fs-base)', lineHeight: 1.55 }}>
            <p style={{ marginTop: 0 }}>
              Misura quanto rende l'hotel rispetto al suo meglio già dimostrato. Tiene insieme occupazione e
              prezzo: sale se riempi di più, sale se vendi meglio.
            </p>
            <h4>Come si calcola</h4>
            <p>
              Fatturato del periodo ÷ fatturato migliore mai ottenuto nello stesso periodo, in percentuale.
              Importi al netto dell'IVA e senza tassa di soggiorno.
            </p>
            <h4>Il riferimento</h4>
            <p>
              Per ogni periodo (inizio stagione aprile–maggio, giugno, luglio, agosto, settembre) si prende
              l'anno migliore dal 2022 in poi. Ogni mese ha il suo: il 100% di agosto non vale quanto il 100%
              di giugno. Quando un anno fa meglio, diventa il nuovo riferimento (dalla stagione successiva).
            </p>
            <h4>Come leggerlo</h4>
            <ul>
              <li>100% = stai rendendo come la tua stagione migliore per quel periodo.</li>
              <li>Sopra 100% = nuovo record.</li>
              <li>Occupazione molto più alta di WAVE = stai riempiendo a prezzo basso.</li>
              <li>WAVE più alto dell'occupazione = meno camere, ma vendute bene.</li>
            </ul>
            <h4>WAVE di stagione</h4>
            <p>
              Totale incassato ÷ somma dei riferimenti: i mesi che valgono più euro pesano di più.
            </p>
            <h4>Dettagli</h4>
            <ul className="ui-text-muted">
              <li>
                Il fatturato è quello delle statistiche Revenue (notte per notte, prenotato compreso); il
                riferimento è per data del documento. Sul singolo mese le due misure possono differire, sulla
                stagione si equivalgono.
              </li>
              <li>
                Aprile e maggio contano solo insieme ("Inizio stagione"): aperture, Pasqua e ponti rendono le
                singole settimane non confrontabili. Il riferimento di una settimana è la quota del mese in
                proporzione ai giorni.
              </li>
            </ul>
          </div>
        </Modal>
      )}
    </>
  )
}
