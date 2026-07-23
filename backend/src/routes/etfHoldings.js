import { Router } from 'express';
import multer from 'multer';
import { parseHoldingsCsv, saveHoldings, heldEtfsWithCoverage } from '../services/etfHoldings.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

// GET /api/etf-holdings — ETF détenus + couverture (composition importée ou non).
router.get('/', async (_req, res, next) => {
  try {
    return res.json({ etfs: await heldEtfsWithCoverage() });
  } catch (err) {
    return next(err);
  }
});

// POST /api/etf-holdings — importe la composition d'un ETF (multipart : etf_isin + file).
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    const etfIsin = String(req.body.etf_isin || '').trim().toUpperCase();
    if (!ISIN_RE.test(etfIsin)) {
      return res.status(400).json({ error: "ISIN d'ETF invalide (champ etf_isin)" });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Fichier manquant (champ multipart "file")' });
    }
    const { delimiter, holdings } = parseHoldingsCsv(req.file.buffer);
    if (req.body.mode === 'preview') {
      return res.json({ etf_isin: etfIsin, delimiter, count: holdings.length, sample: holdings.slice(0, 20) });
    }
    if (!holdings.length) {
      return res.status(422).json({ error: 'Aucune composition détectée dans le fichier', delimiter });
    }
    const result = await saveHoldings(etfIsin, holdings);
    return res.json({ etf_isin: etfIsin, ...result });
  } catch (err) {
    return next(err);
  }
});

export default router;
