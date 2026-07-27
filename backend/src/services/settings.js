import { getPool } from '../db/pool.js';

/**
 * Réglages applicatifs modifiables depuis l'administration.
 *
 * Volontairement en base et non dans l'environnement : l'administrateur doit
 * pouvoir les changer depuis l'interface, sans redéploiement ni redémarrage.
 */

/** Lit un réglage. Renvoie `null` si absent (ou si la table n'existe pas encore). */
export async function getSetting(name) {
  try {
    const [rows] = await getPool().query('SELECT value FROM app_settings WHERE name = ?', [name]);
    return rows.length ? rows[0].value : null;
  } catch {
    // Migration pas encore jouée : se comporter comme « non configuré » plutôt
    // que de faire échouer la connexion de tout le monde.
    return null;
  }
}

/** Écrit un réglage (création ou mise à jour). */
export async function setSetting(name, value) {
  await getPool().query(
    `INSERT INTO app_settings (name, value, updated_at) VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()`,
    [name, value],
  );
  return { name, value };
}

// ── Code d'invitation ────────────────────────────────────────────────

export const INVITE_CODE = 'invite_code';

/** Longueur minimale : un code trop court se devine. */
export const MIN_INVITE_LENGTH = 4;

/**
 * Normalisation appliquée des deux côtés de la comparaison.
 * Casse et espaces de bord ignorés : un code se recopie à la main, souvent
 * depuis un message — exiger la casse exacte ne protège de rien et bloque des
 * invités légitimes.
 */
export const normalizeCode = (v) => String(v ?? '').trim().toLowerCase();

/** Code en vigueur, ou `null` si aucun (inscription alors ouverte). */
export async function getInviteCode() {
  const raw = await getSetting(INVITE_CODE);
  return raw && String(raw).trim() !== '' ? String(raw).trim() : null;
}

/**
 * Le code fourni ouvre-t-il le droit de créer un compte ?
 * Sans code configuré, l'inscription reste ouverte — comportement historique.
 */
export async function inviteCodeAccepts(provided) {
  const expected = await getInviteCode();
  if (!expected) return true;
  return normalizeCode(provided) === normalizeCode(expected);
}

/**
 * Change le code. Une chaîne vide le retire (inscription rouverte à tous), ce
 * qui est un choix légitime mais explicite.
 * @returns {Promise<{ code: string|null } | { error: string }>}
 */
export async function setInviteCode(value) {
  const code = String(value ?? '').trim();
  if (code === '') {
    await setSetting(INVITE_CODE, '');
    return { code: null };
  }
  if (code.length < MIN_INVITE_LENGTH) return { error: 'too_short' };
  if (code.length > 255) return { error: 'too_long' };
  await setSetting(INVITE_CODE, code);
  return { code };
}
