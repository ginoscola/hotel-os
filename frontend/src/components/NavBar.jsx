import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { getUtenteCorrente } from './ProtectedRoute.jsx'
import api from '../api/client.js'
import { APP_VERSION } from '../version.js'
import './NavBar.css'

// ---------------------------------------------------------------------------
// Sottonavigazione per modulo
// ---------------------------------------------------------------------------

function getSubnav(modulo, hotels, isAdmin) {
  if (!modulo) return []

  if (modulo.code === 'revenue') {
    const hotelItems = hotels.map(h => ({ label: h.name, to: `/dashboard/hotel/${h.code}`, small: true }))
    return [
      ...(isAdmin ? [{ label: 'Importazione', to: '/import' }, { tipo: 'sep' }] : []),
      ...hotelItems,
      ...(hotelItems.length > 0 ? [{ tipo: 'sep' }] : []),
      { label: 'Gruppo', to: '/dashboard/gruppo' },
    ]
  }

  // Moduli completi ma senza una subnav propria da mostrare qui: hanno già le loro tab interne
  // (es. Forecast, Corrispettivi, Dipendenti, Statistiche Produzione), non serve/non è più corretto
  // il banner "in sviluppo" sotto la NavBar.
  if (['forecast', 'dipendenti', 'corrispettivi', 'produzione', 'tesoreria'].includes(modulo.code)) {
    return []
  }

  // Moduli non ancora implementati
  return [{ label: `${modulo.icon} ${modulo.name} — in sviluppo`, tipo: 'wip' }]
}

// Mappa route → code modulo
function rilevaModuloAttivo(pathname) {
  // 'home' non è un code modulo reale (nessuna riga in `modules`): nessun tab si evidenzia,
  // che è il comportamento voluto per la landing page.
  if (pathname === '/home' || pathname === '/' || pathname.startsWith('/attivita')) return 'home'
  if (pathname.startsWith('/statistiche-produzione')) return 'produzione'
  if (pathname.startsWith('/budget')) return 'budget'
  if (pathname.startsWith('/usali')) return 'usali'
  if (pathname.startsWith('/dipendenti')) return 'dipendenti'
  if (pathname.startsWith('/corrispettivi')) return 'corrispettivi'
  if (pathname.startsWith('/forecast')) return 'forecast'
  if (pathname.startsWith('/tesoreria')) return 'tesoreria'
  return 'revenue'  // default: /dashboard/*, /import, /admin
}

// ---------------------------------------------------------------------------
// Componenti
// ---------------------------------------------------------------------------

function SubNavItem({ to, children, small }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        ['subnav-link', isActive ? 'subnav-link--active' : '', small ? 'subnav-link--small' : '']
          .filter(Boolean).join(' ')
      }
    >
      {children}
    </NavLink>
  )
}

// ---------------------------------------------------------------------------
// NavBar principale
// ---------------------------------------------------------------------------

export default function NavBar() {
  const navigate = useNavigate()
  const location = useLocation()

  const [utente, setUtente] = useState(null)
  const [appName, setAppName] = useState('HotelOS')
  const [moduli, setModuli] = useState([])
  const [hotels, setHotels] = useState([])
  const [menuAperto, setMenuAperto] = useState(false)   // menu a tendina su cellulare

  // Rilegge utente al cambio route (e chiude il menu del cellulare)
  useEffect(() => {
    setUtente(getUtenteCorrente())
    setMenuAperto(false)
  }, [location.pathname])

  // Ascolta storage (login/logout da altra tab)
  useEffect(() => {
    const handler = () => setUtente(getUtenteCorrente())
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  // Carica nome app, moduli e hotel dopo il login
  useEffect(() => {
    if (!utente) return
    api.get('/config/app_name').then(({ data }) => setAppName(data.value)).catch(() => { /* lista di supporto: errore non mostrato (vedi CLAUDE.md, catch silenziosi) */ })
    api.get('/modules/').then(({ data }) => setModuli(data)).catch(() => { /* lista di supporto: errore non mostrato (vedi CLAUDE.md, catch silenziosi) */ })
    api.get('/hotels/').then(({ data }) => setHotels(data)).catch(() => { /* lista di supporto: errore non mostrato (vedi CLAUDE.md, catch silenziosi) */ })
  }, [utente])

  function handleLogout() {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_user')
    localStorage.removeItem('moduli_permessi')
    navigate('/login', { replace: true })
  }

  if (!utente) return null

  const isAdmin = utente.ruolo === 'admin'
  const codiceAttivo = rilevaModuloAttivo(location.pathname)
  const moduloAttivo = moduli.find(m => m.code === codiceAttivo) || null
  const subnav = getSubnav(moduloAttivo, hotels, isAdmin)

  return (
    <header className="navbar-header">
      {/* ── Livello 1: moduli ── */}
      <nav className="navbar-l1">
        {/* Brand */}
        <NavLink to="/home" className="navbar-brand">
          <img src="/hotelos-icon.svg" alt="HotelOS" className="navbar-brand-logo" />
          {appName}
          <span className="navbar-version">v{APP_VERSION}</span>
        </NavLink>

        {/* Tab moduli */}
        <div className="navbar-moduli">
          {moduli.map(m => (
            <NavLink
              key={m.code}
              to={m.route || '/'}
              className={({ isActive }) =>
                ['navbar-modulo', codiceAttivo === m.code ? 'navbar-modulo--active' : ''].filter(Boolean).join(' ')
              }
              style={codiceAttivo === m.code && m.colore
                ? { borderBottomColor: m.colore, color: '#fff' }
                : {}}
            >
              <span className="navbar-modulo-icon">{m.icon}</span>
              <span className="navbar-modulo-name">{m.name}</span>
            </NavLink>
          ))}
        </div>

        {/* Utente */}
        <div className="navbar-user">
          {isAdmin && (
            <Link to="/admin" className="navbar-admin-link">
              ⚙ Admin
            </Link>
          )}
          <span className="navbar-username">{utente.username}</span>
          <span className={`navbar-badge navbar-badge--${utente.ruolo}`}>{utente.ruolo}</span>
          <button className="navbar-logout" onClick={handleLogout}>Esci</button>
        </div>

        {/* Cellulare: moduli e utente in un menu a tendina (visibile solo su schermi stretti, vedi NavBar.css) */}
        <button className="navbar-hamburger" aria-label="Menu" aria-expanded={menuAperto}
          onClick={() => setMenuAperto(a => !a)}>{menuAperto ? '✕' : '☰'}</button>
      </nav>

      {menuAperto && (
        <nav className="navbar-mobile">
          {moduli.map(m => (
            <Link key={m.code} to={m.route || '/'} onClick={() => setMenuAperto(false)}
              className={['navbar-mobile-voce', codiceAttivo === m.code ? 'navbar-mobile-voce--active' : ''].filter(Boolean).join(' ')}
              style={codiceAttivo === m.code && m.colore ? { borderLeftColor: m.colore } : {}}>
              <span className="navbar-modulo-icon">{m.icon}</span> {m.name}
            </Link>
          ))}
          {isAdmin && <Link to="/admin" className="navbar-mobile-voce navbar-mobile-admin" onClick={() => setMenuAperto(false)}>⚙ Admin</Link>}
          <div className="navbar-mobile-utente">
            <span className="navbar-username">{utente.username}</span>
            <span className={`navbar-badge navbar-badge--${utente.ruolo}`}>{utente.ruolo}</span>
            <button className="navbar-logout" onClick={handleLogout}>Esci</button>
          </div>
        </nav>
      )}

      {/* ── Livello 2: sotto-navigazione ── */}
      {subnav.length > 0 && (
        <nav className="navbar-l2">
          <div className="navbar-l2-inner">
            {subnav.map((item, i) => {
              if (item.tipo === 'sep') return <span key={i} className="subnav-separator" />
              if (item.tipo === 'wip') return (
                <span key={i} className="subnav-wip">{item.label}</span>
              )
              return (
                <SubNavItem key={item.to} to={item.to} small={item.small}>
                  {item.label}
                </SubNavItem>
              )
            })}
          </div>
        </nav>
      )}
    </header>
  )
}
