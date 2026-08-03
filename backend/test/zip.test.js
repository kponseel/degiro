import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { crc32, buildZip } from '../src/services/zip.js';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';
import { readFileSync } from 'node:fs';
import { versionDuManifeste } from '../src/routes/extension.js';

const app = createApp();
afterAll(async () => { await closePool(); });

/**
 * Relit une archive « store » sans dépendance : on suit les local headers et on
 * ré-extrait chaque fichier. C'est notre garantie que le ZIP maison est valide
 * et lisible par Chrome (« Charger l'extension non empaquetée »).
 */
function readStoreZip(buf) {
  const files = {};
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const crc = buf.readUInt32LE(i + 14);
    const size = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const dataStart = i + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + size);
    files[name] = { data, crc, method };
    i = dataStart + size;
  }
  // On doit tomber sur le central directory juste après les fichiers.
  expect(buf.readUInt32LE(i)).toBe(0x02014b50);
  return files;
}

describe('crc32', () => {
  it('donne la valeur de référence', () => {
    expect(crc32(Buffer.from('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
    expect(crc32(Buffer.from(''))).toBe(0);
  });
});

describe('buildZip (méthode store)', () => {
  it('produit une archive relisable, contenu et CRC intacts', () => {
    const entries = [
      { name: 'a.txt', data: Buffer.from('bonjour') },
      { name: 'dir/b.json', data: Buffer.from('{"x":1}') },
      { name: 'bin', data: Buffer.from([0, 1, 2, 255, 254, 10, 13]) },
    ];
    const zip = buildZip(entries);
    expect(zip.subarray(0, 2).toString()).toBe('PK'); // signature ZIP

    const files = readStoreZip(zip);
    expect(Object.keys(files).sort()).toEqual(['a.txt', 'bin', 'dir/b.json']);
    for (const { name, data } of entries) {
      expect(files[name].method).toBe(0);            // store
      expect(Buffer.compare(files[name].data, data)).toBe(0); // contenu identique
      expect(files[name].crc).toBe(crc32(data));     // CRC cohérent
    }
  });

  it('gère le binaire et l’UTF-8 dans les noms', () => {
    const data = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const files = readStoreZip(buildZip([{ name: 'icône.png', data }]));
    expect(Buffer.compare(files['icône.png'].data, data)).toBe(0);
  });

  it('archive vide : central directory présent', () => {
    const zip = buildZip([]);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50); // end of central directory direct
  });
});

describe('GET /api/extension/download', () => {
  it('sert un ZIP téléchargeable, sans authentification', async () => {
    const res = await request(app).get('/api/extension/download').buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('zip');
    // Le nom porte désormais la version : c'est la seule trace qui survit au
    // téléchargement, et elle distingue deux zips dans un dossier.
    expect(res.headers['content-disposition']).toMatch(/degiro-analyzer-extension-[\d.]+\.zip/);

    const files = readStoreZip(res.body);
    const names = Object.keys(files);
    // Le manifeste et le service worker doivent être dans l'archive, préfixés.
    expect(names).toContain('degiro-analyzer/manifest.json');
    expect(names).toContain('degiro-analyzer/src/background.js');
    // Le manifeste extrait doit être un JSON MV3 valide.
    const manifest = JSON.parse(files['degiro-analyzer/manifest.json'].data.toString('utf8'));
    expect(manifest.manifest_version).toBe(3);
  });
});

/**
 * Le numéro de version dans le NOM du fichier.
 *
 * Toutes les versions s'appelaient `degiro-analyzer-extension.zip` : trois zips
 * dans le dossier Téléchargements étaient indiscernables, et l'on rechargeait
 * sans le savoir la version qu'on croyait remplacer. C'est arrivé deux fois de
 * suite sur un vrai correctif.
 */
describe('Nom de l’archive de l’extension', () => {
  it('lit la version du manifeste', () => {
    expect(versionDuManifeste('{"version":"0.5.5","name":"x"}')).toBe('0.5.5');
    expect(versionDuManifeste('{"version":"1.0"}')).toBe('1.0');
  });

  it('refuse ce qui n’a rien à faire dans un en-tête HTTP', () => {
    // Le nom finit dans `Content-Disposition` : un guillemet ou un retour à la
    // ligne y ouvrirait une injection d'en-tête.
    expect(versionDuManifeste('{"version":"1.0\\" ; drop"}')).toBeNull();
    expect(versionDuManifeste('{"version":"1.0\\nX-Evil: 1"}')).toBeNull();
    expect(versionDuManifeste('{"version":"../../etc/passwd"}')).toBeNull();
  });

  it('rend null plutôt que de casser le téléchargement', () => {
    expect(versionDuManifeste('pas du json')).toBeNull();
    expect(versionDuManifeste('{}')).toBeNull();
    expect(versionDuManifeste('')).toBeNull();
  });

  it('sert le zip sous un nom qui porte la version, et l’annonce', async () => {
    const version = JSON.parse(
      readFileSync(new URL('../../extension/manifest.json', import.meta.url), 'utf8'),
    ).version;

    const v = await request(app).get('/api/extension/version');
    expect(v.status).toBe(200);
    expect(v.body.version).toBe(version);

    const dl = await request(app).get('/api/extension/download');
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toBe(
      `attachment; filename="degiro-analyzer-extension-${version}.zip"`,
    );
  });
});
