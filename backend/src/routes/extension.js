import { Router } from 'express';
import { readFile, readdir } from 'node:fs/promises';
import { buildZip } from '../services/zip.js';

const router = Router();

// Dossier de l'extension, à la racine du dépôt (déployé avec le reste).
const EXT_DIR = new URL('../../../extension/', import.meta.url);

/**
 * Ce qui a le droit d'entrer dans l'archive publique.
 *
 * L'archive était construite à partir de TOUT le contenu du dossier `extension/` :
 * n'importe quel fichier déposé là — note de travail, clé, sauvegarde d'éditeur —
 * serait parti dans un ZIP téléchargeable sans authentification. On énumère donc
 * ce qui compose l'extension plutôt que d'espérer que le dossier reste propre.
 */
const ALLOWED = [
  /^manifest\.json$/,
  /^README\.md$/,
  /^src\/[\w.-]+\.(js|html|css)$/,
  /^icons\/[\w.-]+\.png$/,
];

/** Liste récursive des fichiers de l'extension, chemins relatifs à EXT_DIR. */
async function listFiles(dir = EXT_DIR, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(new URL(`${entry.name}/`, dir), rel));
    else if (ALLOWED.some((re) => re.test(rel))) out.push(rel);
  }
  return out;
}

/**
 * Version déclarée par le manifeste — la seule source de vérité.
 *
 * `0` en cas de manifeste illisible : mieux vaut un nom d'archive sans numéro
 * qu'un téléchargement en échec pour une version qu'on n'a pas su lire.
 */
export function versionDuManifeste(texte) {
  try {
    const v = JSON.parse(texte)?.version;
    // Le nom de fichier finit dans un en-tête HTTP : tout ce qui n'est pas
    // chiffre ou point y est refusé, et une version exotique ne doit pas
    // pouvoir y glisser de guillemet ni de retour à la ligne.
    return /^[\d.]{1,20}$/.test(String(v)) ? String(v) : null;
  } catch {
    return null;
  }
}

// Archive construite une fois puis gardée en mémoire (fichiers statiques).
let cached = null;
async function extensionZip() {
  if (cached) return cached;
  const names = (await listFiles()).sort();
  const entries = await Promise.all(
    names.map(async (name) => ({ name: `degiro-analyzer/${name}`, data: await readFile(new URL(name, EXT_DIR)) })),
  );
  const manifeste = await readFile(new URL('manifest.json', EXT_DIR), 'utf8').catch(() => '');
  cached = { zip: buildZip(entries), version: versionDuManifeste(manifeste) };
  return cached;
}

// GET /api/extension/version — numéro affiché à côté du bouton de téléchargement.
router.get('/version', async (_req, res, next) => {
  try {
    const { version } = await extensionZip();
    return res.json({ version });
  } catch (err) {
    return next(err);
  }
});

// GET /api/extension/download — ZIP de l'extension à charger en mode développeur.
router.get('/download', async (_req, res, next) => {
  try {
    const { zip, version } = await extensionZip();
    // Le numéro dans le NOM du fichier : c'est la seule trace qui survit au
    // téléchargement. Sans lui, trois zips dans le dossier Téléchargements sont
    // indiscernables, et l'on recharge sans le savoir la version qu'on croyait
    // remplacer — ce qui est arrivé deux fois de suite.
    const nom = version ? `degiro-analyzer-extension-${version}.zip` : 'degiro-analyzer-extension.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.setHeader('Content-Length', zip.length);
    return res.end(zip);
  } catch (err) {
    return next(err);
  }
});

export default router;
