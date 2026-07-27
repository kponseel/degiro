import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { computeNews, invalidateNews } from '../src/services/news.js';
import { AUTH, resetDb } from './helpers.js';

const app = createApp();

const rss = (titles) => `<rss><channel>${titles
  .map((t, i) => `<item><title>${t} - Le Figaro</title><link>https://news.example/${encodeURIComponent(t)}-${i}</link><pubDate>Mon, 21 Jul 2025 08:00:00 GMT</pubDate></item>`)
  .join('')}</channel></rss>`;

/** Réponse fetch minimale, façon Response. */
const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const denied = (status) => ({ ok: false, status, text: async () => 'refusé' });

async function seed() {
  await request(app).post('/api/ingest').set(AUTH).send({
    source: 'extension',
    capture_id: 'news-1',
    captured_at: '2026-07-20T10:00:00Z',
    positions: [
      { isin: 'US67066G1040', name: 'NVIDIA CORP', product_type: 'STOCK', qty: 10, value_eur: 1050 },
      { isin: 'FR0000131104', name: 'BNP PARIBAS', product_type: 'STOCK', qty: 5, value_eur: 400 },
    ],
  });
}

beforeEach(async () => {
  await resetDb();
  invalidateNews(1);
  await seed();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closePool();
});

describe('Rafraîchissement des actualités', () => {
  it('sert le cache sans rafraîchissement, et refait les appels avec force', async () => {
    const fetchMock = vi.fn(async () => ok(rss(['Nvidia bat le consensus'])));
    vi.stubGlobal('fetch', fetchMock);

    const first = await computeNews(1);
    expect(first.items.length).toBeGreaterThan(0);
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    // Sans force : aucun nouvel appel réseau.
    await computeNews(1);
    expect(fetchMock.mock.calls.length).toBe(calls);

    // Avec force : on ressort sur le réseau.
    await computeNews(1, { force: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });

  it("un rafraîchissement en échec ne doit pas effacer les actualités déjà connues", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(rss(['Nvidia bat le consensus', 'BNP relève son objectif']))));
    const good = await computeNews(1, { force: true });
    expect(good.items.length).toBeGreaterThan(0);
    expect(good.degraded).toBeFalsy();

    // La source publique refuse (403 Google, coupure réseau, quota…).
    vi.stubGlobal('fetch', vi.fn(async () => denied(403)));
    const after = await computeNews(1, { force: true });

    // Le contenu affiché doit survivre à l'échec, et l'échec doit se voir.
    expect(after.items.length).toBe(good.items.length);
    expect(after.available).toBe(true);
    expect(after.degraded).toBe(true);
  });

  it("un échec ne doit pas empoisonner le cache pour les 20 minutes suivantes", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(rss(['Nvidia bat le consensus']))));
    await computeNews(1, { force: true });

    vi.stubGlobal('fetch', vi.fn(async () => denied(403)));
    await computeNews(1, { force: true });

    // Lecture normale juste après : les articles connus doivent toujours être là.
    const later = await computeNews(1);
    expect(later.items.length).toBeGreaterThan(0);
  });

  it('signale une source indisponible quand rien n’a jamais été récupéré', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => denied(429)));
    const res = await computeNews(1, { force: true });
    expect(res.items).toHaveLength(0);
    expect(res.available).toBe(false);
    expect(res.degraded).toBe(true);
  });

  it('expose la date de récupération réellement mise à jour par un rafraîchissement', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok(rss(['Nvidia bat le consensus']))));
    const first = await computeNews(1, { force: true });
    await new Promise((r) => setTimeout(r, 15));
    const second = await computeNews(1, { force: true });
    expect(Date.parse(second.fetchedAt)).toBeGreaterThan(Date.parse(first.fetchedAt));
  });
});
