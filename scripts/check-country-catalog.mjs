import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/shared/countries.json'), 'utf8')
);
const backend = fs.readFileSync(
  path.join(root, 'services/api/src/modules/countries.ts'),
  'utf8'
);
const flutter = fs.readFileSync(
  path.join(root, 'apps/mobile/lib/src/features/auth/country_selector.dart'),
  'utf8'
);

const expected = catalog.countries.map(({ code, name }) => `${code}:${name}`);
const backendCodes = [...backend.matchAll(/'([A-Z]{2})'/g)].map(
  ([, code]) => code
);
const flutterCountries = [
  ...flutter.matchAll(/CountryOption\('([A-Z]{2})', '([^']+)'\)/g)
].map(([, code, name]) => `${code}:${name}`);

if (catalog.version !== 1) {
  throw new Error(`Unsupported country catalog version: ${catalog.version}`);
}

if (backendCodes.join(',') !== catalog.countries.map(({ code }) => code).join(',')) {
  throw new Error('Backend country catalog is out of sync with shared catalog.');
}

if (flutterCountries.join(',') !== expected.join(',')) {
  throw new Error('Flutter country catalog is out of sync with shared catalog.');
}

console.log(`Country catalog v${catalog.version} is synchronized.`);
