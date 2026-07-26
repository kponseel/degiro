import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseCsv, uniqueHeaders, detectKind, mapPortfolio, mapAccount, mapTransactions,
  pickAmount, pickAmountCurrency, extractCashEur,
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

describe('paires montant / devise', () => {
  it('lit le montant quand la colonne nommée porte la devise (relevé)', () => {
    const { rows } = parseCsv('Description,Change,\nDividende,USD,"12,50"');
    expect(pickAmount(rows[0], ['change'])).toBe(12.5);
    expect(pickAmountCurrency(rows[0], ['change'])).toBe('USD');
  });

  it('lit le montant quand la colonne nommée le porte (transactions)', () => {
    const { rows } = parseCsv('Cours,\n"120,50",USD');
    expect(pickAmount(rows[0], ['cours'])).toBe(120.5);
    expect(pickAmountCurrency(rows[0], ['cours'])).toBe('USD');
  });

  it('renvoie null plutôt qu’un nombre inventé si la colonne manque', () => {
    const { rows } = parseCsv('Autre\n1');
    expect(pickAmount(rows[0], ['change'])).toBeNull();
    expect(pickAmountCurrency(rows[0], ['change'])).toBeNull();
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

  it('importe tous les mouvements du relevé', () => {
    const txs = mapAccount(account);
    expect(txs).toHaveLength(8);
  });

  it('classe les mouvements qui comptent', () => {
    const byType = mapAccount(account).reduce((acc, t) => {
      (acc[t.type] ||= []).push(t);
      return acc;
    }, {});

    // Versements et retraits : le TWR est aveugle sans eux.
    expect(byType.deposit).toHaveLength(1);
    expect(byType.deposit[0].amount).toBe(1000);
    expect(byType.withdrawal).toHaveLength(1);
    expect(byType.withdrawal[0].amount).toBe(-200);

    // « Impôt sur dividende » contient « dividende » : il doit rester un impôt.
    expect(byType.dividend).toHaveLength(1);
    expect(byType.dividend[0].amount).toBe(12.5);
    expect(byType.dividend[0].currency).toBe('USD');
    expect(byType.tax).toHaveLength(1);
    expect(byType.tax[0].amount).toBe(-1.88);

    expect(byType.fee).toHaveLength(1);
    expect(byType.fee[0].amount).toBe(-0.5);
    expect(byType.fx).toHaveLength(2);
  });

  it('rattache le dividende à son titre', () => {
    const dividend = mapAccount(account).find((t) => t.type === 'dividend');
    expect(dividend.isin).toBe('US67066G1040');
    expect(dividend.tx_date).toBe('2026-07-19 10:30:00');
  });

  it('lit les transactions avec la bonne devise', () => {
    const txs = mapTransactions(transactions);
    expect(txs).toHaveLength(2);

    const buy = txs.find((t) => t.isin === 'US67066G1040');
    expect(buy.type).toBe('buy');
    expect(buy.qty).toBe(10);
    // « NDQ » est la place de marché : un balayage naïf la prenait pour une devise.
    expect(buy.currency).toBe('USD');
    expect(buy.amount).toBe(-0.5);
    expect(buy.external_id).toBe('abc-123');

    const sell = txs.find((t) => t.isin === 'IE00B4L5Y983');
    expect(sell.type).toBe('sell');
    expect(sell.qty).toBe(-20);
    expect(sell.currency).toBe('EUR');
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

/**
 * Cas relevé sur un export réel : DEGIRO écrit les **en-têtes dans la langue de
 * l'interface** mais garde les **libellés de mouvement en français**. Un fichier
 * peut donc être anglais et français à la fois — et c'est le libellé, pas
 * l'en-tête, qui décide du classement.
 */
describe('export hybride — en-têtes anglais, libellés français', () => {
  const rows = parseCsv(fixture('account-real-mixed.csv')).rows;
  const txs = mapAccount(rows);
  const byType = txs.reduce((acc, t) => { (acc[t.type] ||= []).push(t); return acc; }, {});

  it('est reconnu comme un relevé de compte', () => {
    expect(detectKind(rows)).toBe('account');
  });

  it('lit dividendes et retenues malgré l’en-tête anglais', () => {
    expect(byType.dividend.map((t) => t.amount)).toEqual([0.15, 9.6, 28.35]);
    expect(byType.dividend.every((t) => t.currency === 'USD')).toBe(true);
    // « Impôts » au pluriel : la règle doit rester attrapée.
    expect(byType.tax.map((t) => t.amount)).toEqual([-0.02, -1.44]);
    expect(byType.dividend[0].isin).toBe('US5951121038');
  });

  it('ne prend pas les transferts internes pour des versements', () => {
    // « Cash Sweep » déplace l'argent entre le compte espèces DEGIRO et la
    // banque flatex : compté comme un dépôt, il ruinerait le TWR à chaque ordre.
    const sweep = txs.filter((t) => /Cash Sweep/i.test(t.description));
    expect(sweep).toHaveLength(1);
    expect(sweep[0].type).toBe('other');

    // Seuls les vrais mouvements externes comptent.
    expect(byType.deposit.map((t) => t.amount)).toEqual([500]);
    expect(byType.withdrawal.map((t) => t.amount)).toEqual([-150]);
  });

  it('écarte les lignes « Virement » sans montant plutôt que d’inventer un zéro', () => {
    // Ces lignes doublent la ligne « Cash Sweep » et n'ont pas de colonne Change.
    expect(txs.some((t) => /Virement/i.test(t.description))).toBe(false);
    expect(rows.some((r) => /Virement/i.test(r.Description))).toBe(true);
  });

  it('classe les frais réels, sans y ranger un revenu d’intérêts', () => {
    const fees = byType.fee.map((t) => t.amount);
    expect(fees).toEqual([-2, -0.54, -5]);
    const interest = txs.find((t) => /Interest/i.test(t.description));
    expect(interest.type).toBe('other');
  });

  it('regroupe les opérations de change, accentuées ou non', () => {
    // DEGIRO écrit « Operation » au crédit et « Opération » au débit.
    expect(byType.fx).toHaveLength(2);
    expect(byType.fx.map((t) => t.amount)).toEqual([1279.36, -1128.13]);
  });

  it('laisse achats et ventes en « autre » : ils viennent de Transactions.csv', () => {
    // Les reprendre ici créerait un doublon de chaque ordre, avec un autre
    // identifiant — l'ID d'ordre ne dédoublonne qu'entre fichiers de même type.
    const ordres = txs.filter((t) => /^(Achat|Vente)/.test(t.description));
    expect(ordres).toHaveLength(2);
    expect(ordres.every((t) => t.type === 'other')).toBe(true);
  });
});

describe('parité stricte entre les deux langues', () => {
  const strip = (txs) => txs.map(({ description, external_id: _id, ...rest }) => ({
    ...rest,
    hasDescription: Boolean(description),
  }));

  it('le même relevé donne les mêmes chiffres en anglais et en français', () => {
    const en = strip(mapAccount(parseCsv(fixture('account-real-en.csv')).rows));
    const fr = strip(mapAccount(parseCsv(fixture('account-real-fr.csv')).rows));
    expect(fr).toEqual(en);
  });

  it('les mêmes transactions donnent les mêmes chiffres', () => {
    const en = strip(mapTransactions(parseCsv(fixture('transactions-real-en.csv')).rows));
    const fr = strip(mapTransactions(parseCsv(fixture('transactions-real-fr.csv')).rows));
    expect(fr).toEqual(en);
  });

  it('le même portefeuille donne les mêmes positions', () => {
    const en = mapPortfolio(parseCsv(fixture('portfolio-real.csv')).rows);
    const fr = mapPortfolio(parseCsv(fixture('portfolio-real-fr.csv')).rows);
    expect(fr.map(({ name: _n, ...r }) => r)).toEqual(en.map(({ name: _n, ...r }) => r));
  });
});
