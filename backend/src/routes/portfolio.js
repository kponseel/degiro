import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db/pool.js';

const router = Router();

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/** Positions détenues d'un snapshot (les lignes soldées sont exclues). */
async function positionsOf(pool, snapshotId) {
  const [rows] = await pool.query(
    `SELECT p.isin, p.name, p.qty, p.price, p.currency, p.value_eur, p.pl_eur
     FROM positions p
     WHERE p.snapshot_id = ? AND (p.qty IS NULL OR p.qty <> 0)`,
    [snapshotId],
  );
  return rows;
}

// GET /api/portfolio — positions du dernier snapshot, enrichies par ISIN, avec
// les notes de l'utilisateur, et le snapshot précédent DE LA MÊME SOURCE pour
// la carte « Depuis ta dernière capture ».
router.get('/', async (req, res, next) => {
  try {
    const pool = getPool();
    const [snaps] = await pool.query(
      `SELECT id, captured_at, snapshot_date, source, total_value_eur, cash_eur, net_deposits_eur
       FROM snapshots WHERE account_id = ?
       ORDER BY captured_at DESC LIMIT 1`,
      [req.user.id],
    );
    if (!snaps.length) {
      return res.json({ snapshot: null, positions: [], previous: null });
    }
    const snapshot = snaps[0];
    // Les positions soldées (quantité nulle) qu'une ancienne extension envoyait
    // encore sont exclues : seul le portefeuille ouvert est analysé.
    const [positions] = await pool.query(
      `SELECT p.isin, p.symbol, p.name, p.product_type, p.qty, p.price, p.currency,
              p.fx_rate, p.break_even_price, p.value_eur, p.pl_eur, p.pl_day_eur, p.pl_realized_eur,
              r.sector, r.country, r.asset_class, r.ticker,
              n.thesis AS note_thesis, n.target_weight AS note_target_weight, n.updated_at AS note_updated_at
       FROM positions p
       LEFT JOIN isin_ref r ON r.isin = p.isin
       LEFT JOIN position_notes n ON n.account_id = ? AND n.isin = p.isin
       WHERE p.snapshot_id = ? AND (p.qty IS NULL OR p.qty <> 0)
       ORDER BY p.value_eur DESC`,
      [req.user.id, snapshot.id],
    );

    // Précédent : même source (une capture extension et un import CSV ne se
    // comparent pas — cours, totaux et liquidités n'y sont pas mesurés pareil),
    // jour strictement antérieur.
    const [prev] = await pool.query(
      `SELECT id, captured_at, snapshot_date, source, total_value_eur, cash_eur
       FROM snapshots
       WHERE account_id = ? AND source = ? AND snapshot_date < ?
       ORDER BY snapshot_date DESC LIMIT 1`,
      [req.user.id, snapshot.source, snapshot.snapshot_date],
    );
    const previous = prev.length
      ? { snapshot: prev[0], positions: await positionsOf(pool, prev[0].id) }
      : null;

    return res.json({ snapshot, positions, previous });
  } catch (err) {
    return next(err);
  }
});

const noteSchema = z.object({
  thesis: z.string().max(600).nullable().optional(),
  target_weight: z.number().finite().min(0).max(100).nullable().optional(),
});

// GET /api/portfolio/history — un point par jour capturé : valeur totale,
// liquidités et versements nets, pour la carte « Évolution ». Un jour qui a à la
// fois une capture d'extension et un import CSV garde l'extension (plus
// complète : versements nets, réalisé).
router.get('/history', async (req, res, next) => {
  try {
    const [rows] = await getPool().query(
      `SELECT snapshot_date, source, total_value_eur, cash_eur, net_deposits_eur
       FROM snapshots WHERE account_id = ?
       ORDER BY snapshot_date ASC, (source = 'extension') ASC`,
      [req.user.id],
    );
    const byDay = new Map();
    for (const r of rows) byDay.set(r.snapshot_date, r); // la dernière lue (extension) l'emporte
    return res.json({
      points: [...byDay.values()].map((r) => ({
        date: r.snapshot_date,
        source: r.source,
        total: r.total_value_eur == null ? null : Number(r.total_value_eur),
        cash: r.cash_eur == null ? null : Number(r.cash_eur),
        deposits: r.net_deposits_eur == null ? null : Number(r.net_deposits_eur),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

// PUT /api/portfolio/notes/:isin — note privée sur une position (thèse, poids visé).
// Une note vide (ni thèse ni poids) est supprimée plutôt que gardée vide.
router.put('/notes/:isin', async (req, res, next) => {
  try {
    const isin = String(req.params.isin || '').toUpperCase();
    if (!ISIN_RE.test(isin)) return res.status(400).json({ error: 'ISIN invalide' });
    const parsed = noteSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'Note invalide', details: parsed.error.flatten() });
    const thesis = parsed.data.thesis?.trim() || null;
    const target = parsed.data.target_weight ?? null;
    const pool = getPool();
    if (thesis === null && target === null) {
      await pool.query('DELETE FROM position_notes WHERE account_id = ? AND isin = ?', [req.user.id, isin]);
      return res.json({ isin, thesis: null, target_weight: null });
    }
    await pool.query(
      `INSERT INTO position_notes (account_id, isin, thesis, target_weight, updated_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE thesis = VALUES(thesis), target_weight = VALUES(target_weight), updated_at = UTC_TIMESTAMP()`,
      [req.user.id, isin, thesis, target],
    );
    return res.json({ isin, thesis, target_weight: target });
  } catch (err) {
    return next(err);
  }
});

export default router;
