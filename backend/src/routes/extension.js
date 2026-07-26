import { Router } from 'express';
import { readFile, readdir } from 'node:fs/promises';
import { buildZip } from '../services/zip.js';

const router = Router();

// Dossier de l'extension, à la racine du dépôt (déployé avec le reste).
const EXT_DIR = new URL('../../../extension/', import.meta.url);

/** Liste récursive des fichiers de l'extension, chemins relatifs à EXT_DIR. */
async function listFiles(dir = EXT_DIR, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(new URL(`${entry.name}/`, dir), rel));
    else out.push(rel);
  }
  return out;
}

// Archive construite une fois puis gardée en mémoire (fichiers statiques).
let cached = null;
async function extensionZip() {
  if (cached) return cached;
  const names = (await listFiles()).sort();
  const entries = await Promise.all(
    names.map(async (name) => ({ name: `degiro-analyzer/${name}`, data: await readFile(new URL(name, EXT_DIR)) })),
  );
  cached = buildZip(entries);
  return cached;
}

// GET /api/extension/download — ZIP de l'extension à charger en mode développeur.
router.get('/download', async (_req, res, next) => {
  try {
    const zip = await extensionZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="degiro-analyzer-extension.zip"');
    res.setHeader('Content-Length', zip.length);
    return res.end(zip);
  } catch (err) {
    return next(err);
  }
});

export default router;
