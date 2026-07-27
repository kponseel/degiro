import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Mailer enfichable.
 *  - SMTP configuré (host + user + pass) → envoi réel via nodemailer.
 *  - sinon → mode « dev » : le lien est journalisé et renvoyé par l'API
 *    (uniquement en dev) pour dérouler tout le flux sans serveur mail.
 */
const smtpReady = () => Boolean(config.mail.smtp.host && config.mail.smtp.user && config.mail.smtp.pass);

export const mailerMode = () => (smtpReady() ? 'smtp' : 'dev');

let transportPromise = null;
async function getTransport() {
  if (!transportPromise) {
    transportPromise = import('nodemailer').then(({ default: nodemailer }) =>
      nodemailer.createTransport({
        host: config.mail.smtp.host,
        port: config.mail.smtp.port,
        secure: config.mail.smtp.port === 465, // 465 = TLS implicite, 587 = STARTTLS
        auth: { user: config.mail.smtp.user, pass: config.mail.smtp.pass },
      }),
    );
  }
  return transportPromise;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function renderEmail(link, pseudo) {
  const hi = pseudo ? `Bonjour ${escapeHtml(pseudo)},` : 'Bonjour,';
  const safe = escapeHtml(link);
  const text = `${pseudo ? `Bonjour ${pseudo},` : 'Bonjour,'}\n\nVoici ton lien de connexion à DEGIRO Analyzer (valable ${config.auth.magicTtlMin} min, à usage unique) :\n${link}\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email.`;
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:auto;color:#0f172a">
  <p>${hi}</p>
  <p>Voici ton lien de connexion à <strong>DEGIRO Analyzer</strong>. Il est valable <strong>${config.auth.magicTtlMin} minutes</strong> et à usage unique.</p>
  <p style="margin:28px 0"><a href="${safe}" style="background:#1f6feb;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">Me connecter</a></p>
  <p style="font-size:13px;color:#64748b">Ou copie ce lien : <br>${safe}</p>
  <p style="font-size:13px;color:#64748b">Si tu n'es pas à l'origine de cette demande, ignore simplement cet email.</p>
</div>`;
  return { text, html };
}

/**
 * Envoie le lien magique. Renvoie { mode } — 'smtp' si réellement expédié,
 * 'dev' si journalisé (le flux d'appel exposera alors le lien en dev).
 */
export async function sendMagicLink(email, link, pseudo) {
  if (!smtpReady()) {
    // Le lien vaut une session : il n'est écrit dans les journaux qu'en
    // développement, où il sert justement à dérouler le flux sans serveur mail.
    if (config.auth.devLoginLinks) logger.info(`[mailer:dev] lien magique pour ${email} → ${link}`);
    else logger.warn(`[mailer] SMTP non configuré : aucun lien envoyé à ${email}`);
    return { mode: 'dev' };
  }
  const { text, html } = renderEmail(link, pseudo);
  const transport = await getTransport();
  await transport.sendMail({
    from: config.mail.from,
    to: email,
    subject: 'Ton lien de connexion — DEGIRO Analyzer',
    text,
    html,
  });
  logger.info(`[mailer:smtp] lien magique envoyé à ${email}`);
  return { mode: 'smtp' };
}
