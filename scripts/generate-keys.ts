import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('tmp/porden-keys');
mkdirSync(directory, {recursive: true});
for (const role of ['merchant', 'courier']) {
  const key = generateKeyPairSync('ec', {namedCurve: 'prime256v1'}).privateKey;
  const file = resolve(directory, `${role}.pem`);
  try {writeFileSync(file, key.export({type: 'pkcs8', format: 'pem'}), {flag: 'wx', mode: 0o600}); console.log(`Created ${file}`);}
  catch (error: any) {if (error.code !== 'EEXIST') throw error; console.log(`Preserved ${file}`);}
}
console.log('Generated secret for local configuration:', randomBytes(32).toString('hex'));
