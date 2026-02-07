const { generateKeyPairSync } = require('crypto');
const fs = require('fs');

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const privateJwk = privateKey.export({ format: 'jwk' });
const publicJwk = publicKey.export({ format: 'jwk' });

const privateKeyBuffer = Buffer.from(privateJwk.d, 'base64url');
const publicKeyBuffer = Buffer.from(privateJwk.x, 'base64url');

const keys = {
  privateKey: privateKeyBuffer.toString('hex'),
  publicKey: publicKeyBuffer.toString('hex')
};

fs.writeFileSync('admin_keys.json', JSON.stringify(keys, null, 2));
console.log('Keys generated in admin_keys.json');
console.log('Public Key:', keys.publicKey);
