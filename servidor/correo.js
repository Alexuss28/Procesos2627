// Adaptador de correo: usa la API HTTPS de Brevo (el SMTP está bloqueado en Render gratis).
function crearCorreoBrevo({ apiKey, remitente, nombreRemitente = 'Mi aplicación' }) {
  return {
    async enviarConfirmacion({ email, enlace }) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          sender: { name: nombreRemitente, email: remitente },
          to: [{ email }],
          subject: 'Confirma tu cuenta',
          htmlContent:
            `<p>Hola,</p>` +
            `<p>Para activar tu cuenta pulsa el siguiente enlace (válido durante 24 horas):</p>` +
            `<p><a href="${enlace}">Confirmar mi cuenta</a></p>` +
            `<p>Si no has creado esta cuenta, ignora este mensaje.</p>`,
          textContent: `Para activar tu cuenta abre este enlace (válido 24 horas): ${enlace}`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const detalle = await res.text().catch(() => '');
        throw new Error(`Brevo respondió ${res.status}: ${detalle.slice(0, 200)}`);
      }
    },
  };
}

module.exports = { crearCorreoBrevo };