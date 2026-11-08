import { Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import ErrorePagina from './components/ErrorePagina.jsx'
import Login from './pages/Login.jsx'
import { Loading, UiProvider } from './components/ui'
import lazyConRicarica from './utils/lazyConRicarica.js'

// Ogni pagina è scaricata solo quando la si apre (un file per pagina invece di un unico
// pacchetto da 1,4 MB): v4.30.14. Login resta nel pacchetto iniziale, è la prima pagina.
const HomeCruscotto = lazyConRicarica(() => import('./pages/HomeCruscotto.jsx'))
const Import = lazyConRicarica(() => import('./pages/Import.jsx'))
const ImportBulk = lazyConRicarica(() => import('./pages/ImportBulk.jsx'))
const DashboardHotel = lazyConRicarica(() => import('./pages/DashboardHotel.jsx'))
const DashboardGruppo = lazyConRicarica(() => import('./pages/DashboardGruppo.jsx'))
const AdminUtenti = lazyConRicarica(() => import('./pages/AdminUtenti.jsx'))
const Budget = lazyConRicarica(() => import('./pages/Budget.jsx'))
const Usali = lazyConRicarica(() => import('./pages/Usali.jsx'))
const StatisticheProduzione = lazyConRicarica(() => import('./pages/StatisticheProduzione.jsx'))
const Dipendenti = lazyConRicarica(() => import('./pages/Dipendenti.jsx'))
const Corrispettivi = lazyConRicarica(() => import('./pages/Corrispettivi.jsx'))
const AdminCentriDiCosto = lazyConRicarica(() => import('./pages/AdminCentriDiCosto.jsx'))
const Forecast = lazyConRicarica(() => import('./pages/Forecast.jsx'))
const AdminUnificato = lazyConRicarica(() => import('./pages/AdminUnificato.jsx'))
const Tesoreria = lazyConRicarica(() => import('./pages/Tesoreria.jsx'))
const Attivita = lazyConRicarica(() => import('./pages/Attivita.jsx'))

export default function App() {
  return (
    <UiProvider>
    <BrowserRouter>
      <NavBar />
      <main style={{ padding: '1.5rem 2rem' }}>
        <ErrorePagina>
        <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Home / Cruscotto gruppo — landing page dopo il login */}
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={
            <ProtectedRoute><HomeCruscotto /></ProtectedRoute>
          } />

          {/* ── Modulo Revenue ── */}
          <Route path="/dashboard/hotel/:hotelCode" element={
            <ProtectedRoute moduleCode="revenue"><DashboardHotel /></ProtectedRoute>
          } />
          <Route path="/dashboard/hotel" element={
            <ProtectedRoute moduleCode="revenue"><DashboardHotel /></ProtectedRoute>
          } />
          <Route path="/dashboard/gruppo" element={
            <ProtectedRoute moduleCode="revenue"><DashboardGruppo /></ProtectedRoute>
          } />
          <Route path="/import" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><Import /></ProtectedRoute>
          } />
          <Route path="/import/bulk" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><ImportBulk /></ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute ruoloRichiesto="admin"><AdminUnificato /></ProtectedRoute>
          } />
          <Route path="/admin/utenti" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="revenue"><AdminUtenti /></ProtectedRoute>
          } />
          <Route path="/admin/centri-di-costo" element={
            <ProtectedRoute ruoloRichiesto="admin" moduleCode="dipendenti"><AdminCentriDiCosto /></ProtectedRoute>
          } />

          {/* ── Altri moduli ── */}
          <Route path="/statistiche-produzione" element={
            <ProtectedRoute moduleCode="produzione"><StatisticheProduzione /></ProtectedRoute>
          } />
          <Route path="/budget" element={
            <ProtectedRoute moduleCode="budget"><Budget /></ProtectedRoute>
          } />
          <Route path="/usali" element={
            <ProtectedRoute moduleCode="usali"><Usali /></ProtectedRoute>
          } />
          <Route path="/dipendenti" element={
            <ProtectedRoute moduleCode="dipendenti"><Dipendenti /></ProtectedRoute>
          } />
          <Route path="/corrispettivi" element={
            <ProtectedRoute moduleCode="corrispettivi"><Corrispettivi /></ProtectedRoute>
          } />
          <Route path="/forecast" element={
            <ProtectedRoute moduleCode="forecast"><Forecast /></ProtectedRoute>
          } />
          <Route path="/attivita" element={
            <ProtectedRoute ruoloRichiesto="admin"><Attivita /></ProtectedRoute>
          } />
          <Route path="/tesoreria" element={
            <ProtectedRoute moduleCode="tesoreria"><Tesoreria /></ProtectedRoute>
          } />
        </Routes>
        </Suspense>
        </ErrorePagina>
      </main>
    </BrowserRouter>
    </UiProvider>
  )
}
