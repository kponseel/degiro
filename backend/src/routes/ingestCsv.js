import { Router } from 'express';
import multer from 'multer';
import {
  decodeCsv,
  parseCsv,
  detectKind,
  mapPortfolio,
  mapAccount,
  mapTransactions,
  extractCashEur,
  csvCaptureId,
} from '../services/csvParser.js';
import { ingestSnapshot } from '../services/ingest.js';
import { saveTransactions } from '../services/transactions.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Plafond de lignes traitées en une fois.
 *
 * L'analyse et l'insertion sont synchrones : sur un processus Node unique qui
 * sert aussi le site, un fichier démesuré fige toutes les autres requêtes le
 * temps du traitement. 50 000 lignes couvrent très largement un historique
 * DEGIRO de plusieurs années tout en bornant ce gel à quelques secondes.
 */
const MAX_ROWS = 50_000;

/**
 * Réception du fichier, avec traduction des erreurs de multer.
 *
 * Laissées au gestionnaire central, elles ressortaient en 500 « Erreur interne
 * du serveur » : un fichier trop gros ou un mauvais champ de formulaire est
 * pourtant une erreur de l'utilisateur, qui mérite d'être expliquée.
 */
function receiveFile(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return reject(Object.assign(new Error("Fichier trop volumineux (5 Mo maximum). Découpe ton export par année et importe-les l'un après l'autre — les doublons sont ignorés."), { status: 413 }));
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return reject(Object.assign(new Error(`Champ de fichier inattendu (« ${err.field} ») : le fichier doit être envoyé dans le champ « file ».`), { status: 400 }));
      }
      return reject(Object.assign(new Error("Le fichier n'a pas pu être reçu."), { status: 400 }));
    });
  });
}

// POST /api/ingest/csv — champ multipart `file` ; `kind` (portfolio|account|transactions|auto)
// et `mode` (preview|commit) dans le corps.
router.post('/', async (req, res, next) => {
  try {
    await receiveFile(req, res);
    if (!req.file) {
      return res.status(400).json({ error: 'Fichier manquant (champ multipart "file")' });
    }
    const text = decodeCsv(req.file.buffer);
    let delimiter;
    let rows;
    try {
      ({ delimiter, rows } = parseCsv(text));
    } catch (err) {
      // csv-parse échoue sur un binaire ou un fichier mal formé : c'est un
      // problème de fichier, pas une panne du serveur.
      return res.status(422).json({
        error: "Ce fichier n'est pas un CSV lisible. Vérifie qu'il vient bien de DEGIRO et qu'il est au format CSV (pas Excel).",
        detail: String(err.message || '').slice(0, 200),
      });
    }
    if (!rows.length) {
      return res.status(422).json({ error: 'CSV vide ou illisible' });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(413).json({
        error: `Fichier trop volumineux : ${rows.length} lignes (maximum ${MAX_ROWS}). Découpe l'export par année et importe-les l'un après l'autre — les doublons sont ignorés.`,
      });
    }

    const requested = req.body.kind && req.body.kind !== 'auto' ? req.body.kind : null;
    const kind = requested || detectKind(rows);
    if (!['portfolio', 'account', 'transactions'].includes(kind)) {
      return res.status(422).json({
        error: 'Type de CSV non reconnu',
        delimiter,
        // Les colonnes sans titre portent une clé interne : on la traduit
        // plutôt que d'afficher « __c9 » à quelqu'un qui cherche pourquoi.
        headers: Object.keys(rows[0]).map((h) => (/^__c\d+$/.test(h) ? '(sans titre)' : h)),
      });
    }

    const mappers = { portfolio: mapPortfolio, account: mapAccount, transactions: mapTransactions };
    const normalized = mappers[kind](rows);
    const mode = req.body.mode === 'commit' ? 'commit' : 'preview';

    if (mode === 'preview') {
      return res.json({ kind, delimiter, count: normalized.length, sample: normalized.slice(0, 25) });
    }

    if (kind === 'portfolio') {
      const posTotal = normalized.reduce((s, p) => s + (p.value_eur || 0), 0);
      const cashEur = extractCashEur(rows);
      const totalValueEur = posTotal + (cashEur || 0);
      const result = await ingestSnapshot({
        source: 'csv',
        capture_id: csvCaptureId(text),
        captured_at: new Date().toISOString(),
        total_value_eur: totalValueEur || null,
        cash_eur: cashEur,
        positions: normalized,
      }, req.user.id);
      return res.status(200).json({ kind, positions: normalized.length, cash_eur: cashEur, ...result });
    }

    const result = await saveTransactions(normalized, req.user.id);
    return res.status(200).json({ kind, ...result });
  } catch (err) {
    return next(err);
  }
});

export default router;
