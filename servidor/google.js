const { OAuth2Client, CodeChallengeMethod } = require('google-auth-library');

// Adaptador de Google OAuth 2.0 (flujo de código de autorización con PKCE)
function crearGoogle({ clientId, clientSecret, urlBase }) {
  const redirectUri = `${urlBase}/api/auth/google/callback`;
  const cliente = new OAuth2Client(clientId, clientSecret, redirectUri);

  return {
    // Devuelve la URL de Google y el verificador PKCE, que debe guardarse en la sesión
    async iniciar({ state, nonce }) {
      const { codeVerifier, codeChallenge } = await cliente.generateCodeVerifierAsync();
      const url = cliente.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: CodeChallengeMethod.S256,
        prompt: 'select_account',
      });
      return { url, codeVerifier };
    },

    // Cambia el código por la identidad del usuario, verificando el token de identidad
    async identificar({ code, codeVerifier, nonce }) {
      const { tokens } = await cliente.getToken({ code, codeVerifier });
      if (!tokens.id_token) throw new Error('Google no devolvió el token de identidad');
      const ticket = await cliente.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      const p = ticket.getPayload();
      if (p.nonce !== nonce) throw new Error('El nonce no coincide');
      return { id: p.sub, email: p.email, emailVerificado: p.email_verified === true };
    },
  };
}

module.exports = { crearGoogle };