import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { parseRssItems, searchTerm } from '../src/services/news.js';

const app = createApp();

afterAll(async () => {
  await closePool();
});

describe('News — parsing RSS', () => {
  it('extrait titre, lien, date et isole la source « Titre - Source »', () => {
    const xml = `<rss><channel>
      <item>
        <title>Alibaba grimpe de 5% après ses résultats - Le Figaro</title>
        <link>https://news.google.com/articles/abc</link>
        <pubDate>Mon, 21 Jul 2025 08:00:00 GMT</pubDate>
      </item>
      <item>
        <title><![CDATA[Atos : nouveau plan &amp; restructuration]]></title>
        <link>https://news.google.com/articles/def</link>
        <source url="https://lesechos.fr">Les Echos</source>
        <pubDate>Sun, 20 Jul 2025 10:00:00 GMT</pubDate>
      </item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Alibaba grimpe de 5% après ses résultats');
    expect(items[0].source).toBe('Le Figaro');
    expect(items[0].link).toBe('https://news.google.com/articles/abc');
    // CDATA + entité + source explicite
    expect(items[1].title).toBe('Atos : nouveau plan & restructuration');
    expect(items[1].source).toBe('Les Echos');
  });

  it('ignore les items sans titre ou sans lien', () => {
    const xml = '<item><title>Sans lien</title></item><item><link>https://x</link></item>';
    expect(parseRssItems(xml)).toHaveLength(0);
  });

  it('nettoie les noms DEGIRO pour la recherche', () => {
    expect(searchTerm('ADR ON ALIBABA GROUP HOLDING LTD')).toBe('ALIBABA');
    expect(searchTerm('ALPHABET INC CLASS A')).toBe('ALPHABET');
    expect(searchTerm('ATOS SE')).toBe('ATOS');
    expect(searchTerm('BNP PARIBAS')).toBe('BNP PARIBAS');
  });
});

describe('GET /api/news', () => {
  it('exige une authentification', async () => {
    const res = await request(app).get('/api/news');
    expect(res.status).toBe(401);
  });
});
