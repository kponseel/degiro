import { describe, it, expect } from 'vitest';
import { buildBrowserAgentPrompt, frDate } from '../../frontend/src/lib/browserAgentPrompt.js';

describe('Prompt agent navigateur — format de date', () => {
  it('rend la date au format JJ/MM/AAAA attendu par DEGIRO', () => {
    expect(frDate(new Date(2026, 6, 27))).toBe('27/07/2026');
    // Jour et mois sur deux chiffres, sinon le champ DEGIRO refuse la saisie.
    expect(frDate(new Date(2026, 0, 5))).toBe('05/01/2026');
  });
});

describe('Prompt agent navigateur — contenu', () => {
  const prompt = buildBrowserAgentPrompt({
    appUrl: 'https://degiro.estim.pro',
    today: new Date(2026, 6, 27),
  });

  it('couvre les trois exports DEGIRO', () => {
    expect(prompt).toContain('Portfolio.csv');
    expect(prompt).toContain('Transactions.csv');
    expect(prompt).toContain('Account.csv');
  });

  it('exige la plage de dates complète — le piège n°1 de l’export DEGIRO', () => {
    expect(prompt).toContain('depuis l\'ouverture du compte');
    expect(prompt).toContain('01/01/2000');
    // Le découpage par année est la porte de sortie si DEGIRO refuse la plage.
    expect(prompt).toMatch(/année par année/);
  });

  it('exige l’option « toutes les positions » — le piège n°2', () => {
    expect(prompt).toContain('toutes les positions');
    expect(prompt).toContain('Show all positions');
    // Le critère de contrôle qui prouve que l'option a bien été prise en compte.
    expect(prompt).toContain('quantité 0');
  });

  it('cadre l’agent en lecture seule sur un compte-titres réel', () => {
    expect(prompt).toContain('LECTURE SEULE');
    expect(prompt).toMatch(/JAMAIS passer, modifier ou annuler un ordre/);
    expect(prompt).toMatch(/Ne saisis jamais mes identifiants/);
  });

  it('demande une vérification chiffrée plutôt qu’une conclusion optimiste', () => {
    expect(prompt).toContain('Nombre de lignes');
    expect(prompt).toMatch(/N'invente aucun chiffre/);
  });

  it('injecte l’adresse de l’instance et la date du jour', () => {
    expect(prompt).toContain('https://degiro.estim.pro');
    expect(prompt).toContain('27/07/2026');
  });

  it('normalise l’adresse et survit à une adresse absente', () => {
    const slash = buildBrowserAgentPrompt({ appUrl: 'https://exemple.fr/' });
    expect(slash).toContain('https://exemple.fr →');
    expect(slash).not.toContain('https://exemple.fr/ ');

    const sans = buildBrowserAgentPrompt();
    expect(sans).toContain("l'adresse de DEGIRO Analyzer");
  });
});
