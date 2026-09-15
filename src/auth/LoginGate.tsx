import { useState, type FormEvent } from 'react'
import { useAuth } from './AuthContext'

export function LoginGate() {
  const { status, error, signInWithPassword, clearError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await signInWithPassword(email, password)
    } finally {
      setBusy(false)
    }
  }

  const blocked = status === 'misconfigured'
  const loading = status === 'loading'

  return (
    <div className="vessel-gate login-gate" role="dialog" aria-labelledby="login-gate-title">
      <div className="vessel-gate__card">
        <p className="vessel-gate__eyebrow">Distribution Power System</p>
        <h1 id="login-gate-title" className="vessel-gate__title">
          Acceso restringido
        </h1>
        {loading ? (
          <p className="vessel-gate__hint">Comprobando sesión…</p>
        ) : blocked ? (
          <p className="vessel-gate__hint">
            Esta copia no tiene configurado Firebase. Sin eso no se puede
            validar el usuario.
          </p>
        ) : (
          <>
            <p className="vessel-gate__hint">
              Solo pueden entrar cuentas dadas de alta. No hay registro
              público.
            </p>
            <form className="login-gate__form" onSubmit={onSubmit}>
              <label className="login-gate__label" htmlFor="login-email">
                Correo
              </label>
              <input
                id="login-email"
                className="login-gate__input"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (error) clearError()
                }}
              />
              <label className="login-gate__label" htmlFor="login-password">
                Contraseña
              </label>
              <input
                id="login-password"
                className="login-gate__input"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (error) clearError()
                }}
              />
              {error && <p className="login-gate__error">{error}</p>}
              <button
                type="submit"
                className="btn btn--active login-gate__submit"
                disabled={busy}
              >
                {busy ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
