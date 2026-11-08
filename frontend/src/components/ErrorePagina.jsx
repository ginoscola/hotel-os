import { Component } from 'react'
import { useLocation } from 'react-router-dom'
import { Button, Messaggio } from './ui'
import { mostraErrore } from '../utils/format'

/**
 * Intercetta gli errori della pagina aperta (anche il file della pagina che non si scarica,
 * v4.30.14) e mostra un messaggio con "Ricarica" al posto della schermata bianca. Avvolge solo
 * il contenuto: la barra di navigazione resta utilizzabile. Si azzera cambiando pagina.
 */
class ConfineErrore extends Component {
  constructor(props) {
    super(props)
    this.state = { errore: null }
  }

  static getDerivedStateFromError(errore) {
    return { errore }
  }

  render() {
    if (!this.state.errore) return this.props.children
    return (
      <Messaggio tipo="err">
        <div>Questa pagina non si è caricata correttamente: {mostraErrore(this.state.errore)}</div>
        <div style={{ marginTop: 8 }}>
          <Button onClick={() => window.location.reload()}>Ricarica la pagina</Button>
        </div>
      </Messaggio>
    )
  }
}

export default function ErrorePagina({ children }) {
  const { pathname } = useLocation()
  return <ConfineErrore key={pathname}>{children}</ConfineErrore>
}
