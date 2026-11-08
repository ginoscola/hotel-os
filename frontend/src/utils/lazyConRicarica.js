import { lazy } from 'react'

const CHIAVE = 'hotelos_ricarica_dopo_aggiornamento'

/**
 * `React.lazy` che sopravvive a un aggiornamento dell'app.
 *
 * Ogni pagina è un file JavaScript separato con un nome che cambia a ogni build. Se l'app è
 * aperta durante un aggiornamento, il file della pagina richiesta non esiste più: invece di una
 * schermata vuota la pagina si ricarica (prende la versione nuova), **una volta sola** per
 * sessione, così un errore di rete vero non manda il browser in un ciclo di ricariche.
 */
export default function lazyConRicarica(importa) {
  return lazy(async () => {
    try {
      const modulo = await importa()
      try { sessionStorage.removeItem(CHIAVE) } catch { /* storage non disponibile */ }
      return modulo
    } catch (errore) {
      let giaRicaricato = false
      try { giaRicaricato = sessionStorage.getItem(CHIAVE) === '1' } catch { /* storage non disponibile */ }
      if (!giaRicaricato) {
        try { sessionStorage.setItem(CHIAVE, '1') } catch { /* storage non disponibile */ }
        window.location.reload()
        return new Promise(() => {})   // nessun rendering mentre la pagina si ricarica
      }
      throw errore
    }
  })
}
