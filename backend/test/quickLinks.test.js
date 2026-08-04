import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import {
  newsLinks, stockLinks, yahooUrl, raccourcisTitre, MARCHE,
} from '../../frontend/src/lib/links.js';
import { filtrerTitres } from '../../frontend/src/pages/News.jsx';
import { createApp } from '../src/app.js';
import { getPool, closePool } from '../src/db/pool.js';
import { AUTH, resetDb } from './helpers.js';

/**
 * La page Actus ne récupère plus d'articles : elle donne des liens.
 *
 * Le serveur interrogeait Google News. Sur un hébergement mutualisé, ces appels
 * sont refusés ou limités : l'écran restait figé sur un cache périmé, et le
 * bouton « Actualiser » n'avait aucun effet visible. Le navigateur de
 * l'utilisateur, lui, atteint la source — d'où des liens plutôt qu'un flux.
 */
describe('Liens d’actualité par titre', () => {
  const nvda = { isin: 'US67066G1040', name: 'NVIDIA Corporation', ticker: 'NVDA' };

  it('mène à Google News en français', () => {
    const l = newsLinks(nvda).find((x) => x.label === 'Google News');
    expect(l.url).toContain('news.google.com/search');
    expect(l.url).toContain('NVIDIA%20Corporation');
    // Sans ces paramètres, Google sert la version anglophone selon l'IP du
    // visiteur : une recherche en français doit le rester.
    expect(l.url).toContain('hl=fr');
    expect(l.url).toContain('ceid=FR:fr');
  });

  it('encode ce qui casserait l’URL', () => {
    const l = newsLinks({ name: 'Danone & Cie', isin: 'FR0000120644' });
    expect(l[0].url).toContain('Danone%20%26%20Cie');
    expect(l[0].url).not.toContain(' ');
  });

  it('propose plusieurs angles, pas une seule source', () => {
    const labels = newsLinks(nvda).map((l) => l.label);
    expect(labels).toContain('Google News');
    expect(labels).toContain('Boursorama');
    expect(labels).toContain('Yahoo Finance');
    expect(labels.length).toBeGreaterThanOrEqual(3);
  });

  it('se contente de ce qu’il a — un nom suffit', () => {
    // L'enrichissement ne remplit pas toujours le ticker : la page doit rester
    // utile pour une ligne qui n'a qu'un nom.
    const l = newsLinks({ name: 'Air Liquide' });
    expect(l.length).toBeGreaterThan(0);
    expect(l[0].url).toContain('Air%20Liquide');
  });

  it('ne fabrique rien quand il n’y a rien à chercher', () => {
    expect(newsLinks({})).toEqual([]);
    expect(newsLinks({ name: '   ' })).toEqual([]);
  });

  it('ne propose pas deux fois le même service sous deux noms', () => {
    // Boursorama et Yahoo figuraient dans les DEUX listes : chaque titre les
    // affichait en double, sous « Yahoo Finance » puis « Yahoo ». Le
    // dédoublonnage se fait par domaine, car c'est l'adresse qui fait foi.
    const { actu, donnees } = raccourcisTitre(nvda);
    const hote = (u) => new URL(u).hostname.replace(/^www\./, '');
    const hotesActu = actu.map((l) => hote(l.url));
    for (const l of donnees) {
      expect(hotesActu, `${l.label} fait doublon`).not.toContain(hote(l.url));
    }
    expect(donnees.map((l) => l.label)).toEqual(['Finviz', 'TradingView']);
  });

  it('garde les pages de données existantes', () => {
    expect(yahooUrl({ ticker: 'NVDA' })).toBe('https://finance.yahoo.com/quote/NVDA');
    expect(stockLinks(nvda).map((l) => l.label)).toContain('TradingView');
  });
});

describe('Raccourcis de marché', () => {
  it('groupe les liens par intention, et tous sont absolus et sûrs', () => {
    expect(MARCHE.length).toBeGreaterThanOrEqual(3);
    for (const bloc of MARCHE) {
      expect(bloc.groupe, 'groupe sans titre').toBeTruthy();
      expect(bloc.liens.length).toBeGreaterThan(0);
      for (const l of bloc.liens) {
        expect(l.label, 'lien sans libellé').toBeTruthy();
        expect(l.url, `${l.label} n'est pas en https`).toMatch(/^https:\/\//);
      }
    }
  });

  it('ne propose pas deux fois le même libellé dans un groupe', () => {
    for (const bloc of MARCHE) {
      const labels = bloc.liens.map((l) => l.label);
      expect(new Set(labels).size, `doublon dans « ${bloc.groupe} »`).toBe(labels.length);
    }
  });
});

describe('Filtre de la liste des titres', () => {
  const titres = [
    { isin: 'A', name: 'NVIDIA', ticker: 'NVDA', sector: 'Technologie' },
    { isin: 'B', name: 'TotalEnergies', ticker: 'TTE', sector: 'Énergie' },
    { isin: 'C', name: 'Sans secteur', ticker: null, sector: null },
  ];

  it('cherche par nom, ISIN ou ticker', () => {
    expect(filtrerTitres(titres, 'nvid', null).map((s) => s.isin)).toEqual(['A']);
    expect(filtrerTitres(titres, 'TTE', null).map((s) => s.isin)).toEqual(['B']);
  });

  it('filtre par secteur, en rangeant les non classés à part', () => {
    expect(filtrerTitres(titres, '', 'Énergie').map((s) => s.isin)).toEqual(['B']);
    expect(filtrerTitres(titres, '', 'Non classé').map((s) => s.isin)).toEqual(['C']);
  });

  it('sans filtre, rend tout', () => {
    expect(filtrerTitres(titres, '', null)).toHaveLength(3);
    expect(filtrerTitres(null, 'x', null)).toEqual([]);
  });
});

describe('GET /api/news — la liste des titres, sans appel sortant', () => {
  const app = createApp();
  afterAll(async () => { await closePool(); });

  it('rend les titres détenus et plus aucun article', async () => {
    await resetDb();
    await request(app).post('/api/ingest').set(AUTH).send({
      source: 'extension',
      capture_id: 'ql-1',
      captured_at: '2026-08-04T10:00:00Z',
      total_value_eur: 1000,
      positions: [{ isin: 'US67066G1040', name: 'NVIDIA Corp', qty: 3, value_eur: 1000 }],
    });
    await getPool().query(
      "INSERT INTO isin_ref (isin, ticker, sector) VALUES ('US67066G1040', 'NVDA', 'Technologie')",
    );

    const res = await request(app).get('/api/news').set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.stocks).toHaveLength(1);
    expect(res.body.stocks[0]).toMatchObject({ isin: 'US67066G1040', ticker: 'NVDA', sector: 'Technologie' });
    // Plus d'articles : c'est le navigateur qui va les chercher désormais.
    expect(res.body.items).toEqual([]);
  });

  it('exige une authentification', async () => {
    expect((await request(app).get('/api/news')).status).toBe(401);
  });
});
