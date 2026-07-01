import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import Import from './pages/Import.jsx'
import ImportBulk from './pages/ImportBulk.jsx'
import DashboardHotel from './pages/DashboardHotel.jsx'
import DashboardGruppo from './pages/DashboardGruppo.jsx'
import AdminUtenti from './pages/AdminUtenti.jsx'
import Budget from './pages/Budget.jsx'
import Usali from './pages/Usali.jsx'
import Dipendenti from './pages/Dipendenti.jsx'
import Corrispettivi from './pages/Corrispettivi.jsx'
import AdminCentriDiCosto from './pages/AdminCentriDiCosto.jsx'
import Forecast from './pages/Forecast.jsx'
import AdminUnificato from './pages/AdminUnificato.jsx'

export default function App() {
  return (
    <BrowserRouter>
      <NavBar />
      <main style={{ padding: '1.5rem 2rem' }}>
        <Routes>
          <Route path="/login" element={<Login />} />

          {/* Redirect root → dashboard gruppo */}
          <Route path="/" element={<Navigate to="/dashboard/gruppo" replace />} />

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
        </Routes>
      </main>
    </BrowserRouter>
  )
}
