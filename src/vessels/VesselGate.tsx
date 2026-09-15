import { useAuth } from '../auth'
import { appBuildLabel, forceRefreshApp } from '../registerPwa'
import { VESSELS, type VesselId } from './vesselCatalog'

type VesselGateProps = {
  onSelect: (id: VesselId) => void
}

/** Pantalla obligatoria al abrir la app: elegir escritorio de buque. */
export function VesselGate({ onSelect }: VesselGateProps) {
  const { email, signOutUser, isAdmin } = useAuth()
  const build = appBuildLabel()
  return (
    <div className="vessel-gate" role="dialog" aria-labelledby="vessel-gate-title">
      <div className="vessel-gate__card">
        <p className="vessel-gate__eyebrow">Distribution Power System</p>
        <h1 id="vessel-gate-title" className="vessel-gate__title">
          Elegir buque
        </h1>
        <p className="vessel-gate__hint">
          Cada escritorio tiene sus propios candados LOTO y notas de revisión. El
          unifilar es común.
        </p>
        {email ? (
          <p className="vessel-gate__hint login-gate__session">
            Sesión: {email}
            {isAdmin ? ' · administrador' : ''}{' '}
            <button
              type="button"
              className="login-gate__link"
              onClick={() => void signOutUser()}
            >
              Cerrar sesión
            </button>
          </p>
        ) : null}
        <ul className="vessel-gate__list">
          {VESSELS.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className="vessel-gate__btn"
                onClick={() => onSelect(v.id)}
              >
                <span className="vessel-gate__id">{v.id}</span>
                <span className="vessel-gate__name">{v.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="vessel-gate__hint" style={{ marginTop: '1rem' }}>
          Build {build}
        </p>
        <button
          type="button"
          className="btn btn--active"
          style={{ width: '100%', marginTop: '0.5rem' }}
          onClick={() => void forceRefreshApp()}
        >
          Forzar actualización (borrar caché)
        </button>
      </div>
    </div>
  )
}
