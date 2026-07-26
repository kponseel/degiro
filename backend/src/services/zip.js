/**
 * Constructeur ZIP minimal, méthode « store » (sans compression).
 *
 * Pourquoi maison plutôt qu'une dépendance : le seul besoin est d'empaqueter
 * une douzaine de petits fichiers pour le téléchargement de l'extension. Le
 * format « store » est simple et vérifiable (on relit l'archive dans les
 * tests), ça évite d'ajouter une lib de compression pour si peu.
 *
 * Module pur : entrées { name, data:Buffer } → Buffer ZIP. Horodatage fixe pour
 * une archive déterministe (utile au cache et aux tests).
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 1er janvier 2026, 00:00 en date/heure DOS (archive déterministe).
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * @param {Array<{name:string,data:Buffer}>} entries
 * @returns {Buffer} archive ZIP
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flags : nom en UTF-8
    local.writeUInt16LE(0, 8);             // méthode : store
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);  // taille compressée = taille brute
    local.writeUInt32LE(data.length, 22);  // taille brute
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);            // extra len
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);  // signature
    central.writeUInt16LE(20, 4);          // version made by
    central.writeUInt16LE(20, 6);          // version needed
    central.writeUInt16LE(0x0800, 8);      // flags
    central.writeUInt16LE(0, 10);          // méthode
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);          // extra len
    central.writeUInt16LE(0, 32);          // comment len
    central.writeUInt16LE(0, 34);          // disk number start
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE(0, 38);          // external attrs
    central.writeUInt32LE(offset, 42);     // offset du local header
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);        // signature
  end.writeUInt16LE(0, 4);                 // disk
  end.writeUInt16LE(0, 6);                 // disk start
  end.writeUInt16LE(entries.length, 8);    // entrées sur ce disque
  end.writeUInt16LE(entries.length, 10);   // entrées totales
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);           // offset du central dir
  end.writeUInt16LE(0, 20);                // comment len

  return Buffer.concat([...locals, centralDir, end]);
}
