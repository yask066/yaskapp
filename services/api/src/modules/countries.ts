import { z } from 'zod';

export const countryCatalogVersion = 1;

// ISO 3166-1 alpha-2 identifiers supported by the first country catalog.
export const supportedCountryCodes = [
  'BY',
  'LT',
  'LV',
  'PL',
  'RU',
  'UA',
  'DE',
  'GB',
  'US'
] as const;

export type IsoAlpha2CountryCode = (typeof supportedCountryCodes)[number];

function validateCountryCatalog(codes: readonly string[]) {
  if (
    codes.some((code) => !/^[A-Z]{2}$/.test(code)) ||
    new Set(codes).size !== codes.length
  ) {
    throw new Error(
      'Country catalog must contain unique uppercase ISO alpha-2 codes.'
    );
  }
}

validateCountryCatalog(supportedCountryCodes);

export const supportedCountryCodeSchema = z.enum(supportedCountryCodes);
