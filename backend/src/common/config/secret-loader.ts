import * as fs from 'node:fs';

export function loadSecret(name: string): string {
  const fileVar = `${name}_FILE`;
  const filePath = process.env[fileVar];
  if (filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8').trim();
    } catch (err) {
      throw new Error(`Failed to read secret file ${filePath} for ${name}: ${err}`);
    }
  }
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required secret: ${name} (set ${name} or ${name}_FILE)`);
  }
  return val;
}
