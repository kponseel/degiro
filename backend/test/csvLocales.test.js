import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseCsv, uniqueHeaders, detectKind, mapPortfolio, extractCashEur,
} from '../src/services/csvParser.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/**
 * Parité anglais / français sur les exports DEGIRO au format réel.
 *
 * Le format réel a deux pièges que la version simplifiée n'avait pas :
 * des colonnes **sans en-tête** (montant et devise vont par paires), et des
 * libellés propres à chaque langue. Les deux ont cassé silencieusement — ces
 * tests existent pour que ça ne se reproduise pas.
 */

describe('en-têtes dupliqués ou vides', () => {
  it('donne une clé unique à chaque colonne, dans l’ordre', () => {
    expect(uniqueHeaders(['Date', '', 'Change', '', 'Balance', ''])).toEqual([
      'Date', '__c1', 'Change', '__c3', 'Balance', '__c5',
    ]);
  });

  it('ne fusionne pas deux colonnes homonymes', () => {
    expect(uniqueHeaders(['Valeur', 'Valeur'])).toEqual(['Valeur', 'Valeur__2']);
  });

  it('conserve toutes les valeurs d’une ligne aux colonnes sans titre', () => {
    const { rows } = parseCsv('A,,B,\n1,2,3,4');
    // Sans clés uniques, « 2 » et « 4 » s'écrasaient et tout décalait d'un cran.
    expect(Object.values(rows[0])).toEqual(['1', '2', '3', '4']);
  });
});

describe.each([
  ['anglais', 'account-real-en.csv', 'transactions-real-en.csv', 'portfolio-real.csv'],
  ['français', 'account-real-fr.csv', 'transactions-real-fr.csv', 'portfolio-real-fr.csv'],
])('export DEGIRO réel — %s', (_langue, accountFile, txFile, portfolioFile) => {
  const account = parseCsv(fixture(accountFile)).rows;
  const transactions = parseCsv(fixture(txFile)).rows;
  const portfolio = parseCsv(fixture(portfolioFile)).rows;

  it('reconnaît chaque fichier pour ce qu’il est', () => {
    // Le relevé porte aussi un « ID de l'ordre » : il se faisait passer pour
    // un fichier de transactions, et repartait dans le mauvais importeur.
    expect(detectKind(account)).toBe('account');
    expect(detectKind(transactions)).toBe('transactions');
    expect(detectKind(portfolio)).toBe('portfolio');
  });

  it('lit le portefeuille de la même façon dans les deux langues', () => {
    const positions = mapPortfolio(portfolio);
    expect(positions).toHaveLength(27);
    const alibaba = positions.find((p) => p.isin === 'US01609W1027');
    expect(alibaba.qty).toBe(46);
    expect(alibaba.currency).toBe('USD');
    expect(alibaba.value_eur).toBe(4698.51);
    expect(extractCashEur(portfolio)).toBe(6435.86);
  });
});

describe('liquidités sur plusieurs devises', () => {
  it('additionne chaque ligne de trésorerie, en euros', () => {
    // Synthétique, au format réel de DEGIRO : une ligne de trésorerie par devise.
    const { rows } = parseCsv([
      'Product,Symbol/ISIN,Amount,Closing,Local value,,Value in EUR',
      'CASH & CASH FUND & FTX CASH (EUR),,,,EUR,"1000,50","1000,50"',
      'CASH & CASH FUND & FTX CASH (USD),,,,USD,"2,24","1,97"',
      'ACME CORP,US0000000001,3,"10,00",USD,"30,00","26,37"',
    ].join('\n'));
    expect(extractCashEur(rows)).toBe(1002.47);
    expect(mapPortfolio(rows)).toHaveLength(1);
  });
});

describe('parité stricte entre les deux langues', () => {
  it('le même portefeuille donne les mêmes positions', () => {
    const en = mapPortfolio(parseCsv(fixture('portfolio-real.csv')).rows);
    const fr = mapPortfolio(parseCsv(fixture('portfolio-real-fr.csv')).rows);
    expect(fr.map(({ name: _n, ...r }) => r)).toEqual(en.map(({ name: _n, ...r }) => r));
  });
});
