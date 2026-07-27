import { getPool } from '../db/pool.js';
import { logger } from '../logger.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

// Cache mémoire par utilisateur (2-3 utilisateurs → largement suffisant).
const CACHE_TTL_MS = 20 * 60 * 1000;
const cache = new Map(); // accountId -> { at, items, stocks }

const decodeEntities = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();

/** Parse les <item> d'un flux RSS. Fonction pure (testable sans réseau). */
export function parseRssItems(xml) {
  const items = [];
  const blocks = String(xml || '').split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const body = raw.split(/<\/item>/i)[0];
    const pick = (tag) => {
      const m = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? decodeEntities(m[1]) : null;
    };
    const rawTitle = pick('title');
    const link = pick('link');
    if (!rawTitle || !link) continue;
    const source = pick('source');
    // Google News formate « Titre - Source » ; on isole la source si absente du tag.
    let title = rawTitle;
    let src = source;
    if (!src) {
      const dash = rawTitle.lastIndexOf(' - ');
      if (dash > 0) { title = rawTitle.slice(0, dash).trim(); src = rawTitle.slice(dash + 3).trim(); }
    }
    const pubDate = pick('pubDate');
    items.push({ title, link, source: src || null, pubDate: pubDate || null });
  }
  return items;
}

/** Terme de recherche propre à partir d'un nom DEGIRO (retire suffixes juridiques/ADR). */
export function searchTerm(name) {
  return String(name || '')
    .replace(/\bADR ON\b/gi, '')
    .replace(/\b(CLASS [A-C]|CL [A-C])\b/gi, '')
    .replace(/\b(LTD|INC|CORP|CORPORATION|PLC|N\.?V\.?|S\.?A\.?|S\.?E\.?|A\.?G\.?|HOLDING|GROUP|CO)\b\.?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const ts = (d) => {
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? t : 0;
};

async function fetchGoogleNews(query) {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    '&hl=fr-FR&gl=FR&ceid=FR:fr';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA } });
    clearTimeout(timer);
    if (!res.ok) return [];
    return parseRssItems(await res.text());
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function withPool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  });
  await Promise.all(workers);
  return out;
}

/** Positions du dernier snapshot (nom, ticker, ISIN, classe, valeur) pour un utilisateur. */
async function heldStocks(accountId) {
  const [rows] = await getPool().query(
    `SELECT p.isin, MAX(p.name) AS name, MAX(p.value_eur) AS value_eur,
            r.ticker, r.asset_class, r.sector
     FROM positions p LEFT JOIN isin_ref r ON r.isin = p.isin
     WHERE p.snapshot_id = (SELECT id FROM snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1)
       AND (p.qty IS NULL OR p.qty <> 0)
     GROUP BY p.isin, r.ticker, r.asset_class, r.sector
     ORDER BY value_eur DESC`,
    [accountId],
  );
  return rows;
}

/**
 * Actualités agrégées des titres du portefeuille (Google News RSS, FR).
 * Best-effort + cache 20 min. Chaque article est tagué par titre (filtrable).
 * @returns {Promise<{ available:boolean, items:Array, stocks:Array, cachedAt:string }>}
 */
export async function computeNews(accountId, { symbol, force = false } = {}) {
  const stocksAll = await heldStocks(accountId);
  const stocks = stocksAll.map((s) => ({ isin: s.isin, name: s.name, ticker: s.ticker || null, sector: s.sector || null }));

  const cached = cache.get(accountId);
  let all;
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    all = cached.items;
  } else {
    // Top positions pour rester rapide ; on évite les ETF (news moins pertinente par titre).
    const targets = stocksAll
      .filter((s) => s.asset_class !== 'ETF' && s.asset_class !== 'ETC')
      .slice(0, 12);
    const results = await withPool(targets, 4, async (s) => {
      const term = searchTerm(s.name) || s.name;
      const items = await fetchGoogleNews(`${term} action bourse`);
      return items.slice(0, 6).map((it) => ({ ...it, isin: s.isin, stock: s.name, sector: s.sector || null }));
    });
    const seen = new Set();
    all = results
      .flat()
      .filter((it) => { const k = it.link; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => ts(b.pubDate) - ts(a.pubDate))
      .slice(0, 60);
    cache.set(accountId, { at: Date.now(), items: all, stocks });
  }

  const items = symbol ? all.filter((it) => it.isin === symbol) : all;
  return {
    available: all.length > 0,
    items,
    stocks,
    cachedAt: new Date((cache.get(accountId)?.at) || Date.now()).toISOString(),
  };
}

/** Vide le cache d'un utilisateur (après un nouvel import par ex.). */
export function invalidateNews(accountId) {
  cache.delete(accountId);
}

logger.debug?.('news service chargé');
