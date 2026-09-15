import { useEffect, useState } from 'react'
import { ScadaCanvas } from './components/ScadaCanvas'
import './App.css'
import './mobile.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { VesselGate } from './vessels/VesselGate'
import type { VesselId } from './vessels/vesselCatalog'
import { NotesProvider, UserProfileProvider, useUserProfile } from './notes'
import { UserProfileModal } from './components/UserProfileModal'
import { hasDisplayName } from './notes/userProfile'
import { useScadaMobileHtmlClass } from './hooks/useScadaMobileHtmlClass'
import { AuthProvider, LoginGate, useAuth } from './auth'

function AppShell({
  vesselId,
  onVesselChange,
}: {
  vesselId: VesselId
  onVesselChange: (id: VesselId) => void
}) {
  const { openProfilePrompt, profile } = useUserProfile()
  const needsName = !profile && !hasDisplayName()
  useScadaMobileHtmlClass()

  useEffect(() => {
    if (needsName) {
      openProfilePrompt(
        'Indica tu nombre para firmar las notas de revisión a bordo.',
      )
    }
  }, [needsName, openProfilePrompt])

  return (
    <NotesProvider vesselId={vesselId}>
      <ScadaCanvas vesselId={vesselId} onVesselChange={onVesselChange} />
      <UserProfileModal required={needsName} />
    </NotesProvider>
  )
}

function VesselGateScreen({
  onSelect,
}: {
  onSelect: (id: VesselId) => void
}) {
  useScadaMobileHtmlClass()
  return <VesselGate onSelect={onSelect} />
}

function SignedInApp() {
  const [activeVessel, setActiveVessel] = useState<VesselId | null>(null)
  const { status } = useAuth()
  useScadaMobileHtmlClass()

  if (status !== 'ready') {
    return <LoginGate />
  }

  return (
    <UserProfileProvider>
      {activeVessel == null ? (
        <VesselGateScreen onSelect={setActiveVessel} />
      ) : (
        <AppShell
          vesselId={activeVessel}
          onVesselChange={setActiveVessel}
        />
      )}
    </UserProfileProvider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <SignedInApp />
      </AuthProvider>
    </ErrorBoundary>
  )
}
