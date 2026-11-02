'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const PRODUCT_IMAGE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp)$/i;
const TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: TYPES.jpg };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: TYPES.png };
  }
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: TYPES.webp };
  }
  return null;
}

function productImageDir(uploadDir) {
  return path.join(uploadDir, 'products');
}

async function storeProductImage(buffer, uploadDir) {
  const type = sniffImage(buffer);
  if (!type) {
    const error = new Error('Choose a JPG, PNG or WebP image.');
    error.status = 400;
    error.publicMessage = error.message;
    throw error;
  }
  const directory = productImageDir(uploadDir);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `${crypto.randomUUID()}.${type.ext}`;
  await fs.writeFile(path.join(directory, filename), buffer, { mode: 0o600, flag: 'wx' });
  return { filename, mime: type.mime, url: `/media/products/${filename}` };
}

async function deleteProductImage(filename, uploadDir) {
  if (!PRODUCT_IMAGE.test(filename || '')) return;
  await fs.unlink(path.join(productImageDir(uploadDir), filename)).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

function mediaType(filename) {
  if (!PRODUCT_IMAGE.test(filename || '')) return null;
  const ext = path.extname(filename).slice(1).toLowerCase();
  return TYPES[ext] || null;
}

module.exports = { PRODUCT_IMAGE, sniffImage, storeProductImage, deleteProductImage, mediaType, productImageDir };
