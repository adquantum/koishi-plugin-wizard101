'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

class PortraitStore {
  constructor(root) { this.root = root; this.cache = new Map(); this.closed = false; }
  async get(filename) {
    if (this.closed || !this.root || typeof filename !== 'string' || !/^[^/\\:\x00-\x1f]{1,205}\.png$/iu.test(filename) || filename.startsWith('.')) return '';
    if (this.cache.has(filename)) return this.cache.get(filename);
    try {
      const root = await fs.realpath(this.root);
      const file = await fs.realpath(path.join(root, filename));
      if (path.dirname(file) !== root) return '';
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 2097152) return '';
      const data = await fs.readFile(file);
      if (data.length > 2097152 || data.length < 33 || !data.subarray(0, 8).equals(PNG) || data.toString('ascii', 12, 16) !== 'IHDR') return '';
      const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
      if (!width || !height || width > 2048 || height > 2048 || width * height > 4194304 || this.closed) return '';
      const uri = 'data:image/png;base64,' + data.toString('base64');
      while (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value);
      this.cache.set(filename, uri);
      return uri;
    } catch { return ''; }
  }
  dispose() { this.closed = true; this.cache.clear(); }
}

module.exports = { PortraitStore };
