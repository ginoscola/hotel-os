import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState, useMemo } from 'react'
import { getUtenteCorrente } from './ProtectedRoute.jsx'
import api from '../api/client.js'
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
      ...(isAdmin ? [{ tipo: 'sep' }, { label: 'Admin', to: '/admin' }] : []),
    ]
  }

  // Moduli non ancora implementati
  return [{ label: `${modulo.icon} ${modulo.name} — in sviluppo`, tipo: 'wip' }]
}

// Mappa route → code modulo
function rilevaModuloAttivo(pathname) {
  if (pathname.startsWith('/budget')) return 'budget'
  if (pathname.startsWith('/usali')) return 'usali'
  if (pathname.startsWith('/dipendenti')) return 'dipendenti'
  if (pathname.startsWith('/corrispettivi')) return 'corrispettivi'
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

  // Rilegge utente al cambio route
  useEffect(() => {
    setUtente(getUtenteCorrente())
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
    api.get('/config/app_name').then(({ data }) => setAppName(data.value)).catch(() => {})
    api.get('/modules/').then(({ data }) => setModuli(data)).catch(() => {})
    api.get('/hotels/').then(({ data }) => setHotels(data)).catch(() => {})
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
        <NavLink to="/dashboard/gruppo" className="navbar-brand">
          <img src="/logo.png" alt="Logo" className="navbar-brand-logo" />
          {appName}
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
          <span className="navbar-username">{utente.username}</span>
          <span className={`navbar-badge navbar-badge--${utente.ruolo}`}>{utente.ruolo}</span>
          <button className="navbar-logout" onClick={handleLogout}>Esci</button>
        </div>
      </nav>

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
