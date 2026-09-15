export function authErrorMessage(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code: string }).code)
      : ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Correo o contraseña incorrectos.'
    case 'auth/user-disabled':
      return 'Esta cuenta está deshabilitada.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera unos minutos.'
    case 'auth/operation-not-allowed':
      return 'Este método de acceso no está activado en Firebase.'
    case 'auth/unauthorized-domain':
      return 'Este dominio no está autorizado en Firebase Authentication.'
    case 'auth/network-request-failed':
      return 'Sin red. Comprueba la conexión e inténtalo de nuevo.'
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'No se pudo iniciar sesión.'
  }
}
