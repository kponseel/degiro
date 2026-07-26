import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { crc32, buildZip } from '../src/services/zip.js';
import { createApp } from '../src/app.js';
import { closePool } from '../src/db/pool.js';

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
    expect(res.headers['content-disposition']).toContain('degiro-analyzer-extension.zip');

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
