import 'dotenv/config';

import { z } from 'zod';

const developmentJwtSecret = 'development-only-secret';
const developmentPaginationCursorSecret = 'development-only-pagination-cursor-secret-replace-before-production';
const journalDatabaseUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'postgres:' || protocol === 'postgresql:';
}, 'Must be a PostgreSQL connection URL.');

const envSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGINS: z.string().default('*'),
  STAGING_PUBLIC_IP: z.string().ip().optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16).default(developmentJwtSecret),
  PAGINATION_CURSOR_SECRET: z
    .string()
    .min(32)
    .refine((value) => Buffer.byteLength(value, 'utf8') >= 32)
    .default(developmentPaginationCursorSecret),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  ACCOUNT_DELETION_ENABLED: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  ACCOUNT_DELETION_JOURNAL_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  ACCOUNT_DELETION_JOURNAL_DATABASE_URL: journalDatabaseUrlSchema.optional(),
  ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL: journalDatabaseUrlSchema.optional(),
  ACCOUNT_DELETION_JOURNAL_ID: z.string().min(1).optional(),
  ACCOUNT_DELETION_JOURNAL_HMAC_KEY: z.string().min(32).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1).optional()
  })
  .superRefine((config, context) => {
    if (
      config.ACCOUNT_DELETION_JOURNAL_ENABLED &&
      (!config.ACCOUNT_DELETION_JOURNAL_DATABASE_URL ||
       !config.ACCOUNT_DELETION_JOURNAL_ID ||
       !config.ACCOUNT_DELETION_JOURNAL_HMAC_KEY)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_DELETION_ENABLED'],
        message: 'Account deletion cannot be enabled without its independent durable journal.'
      });
    }
    const journalUrls = [
      ['ACCOUNT_DELETION_JOURNAL_DATABASE_URL', config.ACCOUNT_DELETION_JOURNAL_DATABASE_URL],
      ['ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL', config.ACCOUNT_DELETION_JOURNAL_RETENTION_DATABASE_URL]
    ] as const;
    for (const [key, journalUrl] of journalUrls) {
      if (!journalUrl) continue;
      try {
        const parsed = new URL(journalUrl);
        const journalHost = parsed.hostname.toLowerCase();
        const sslMode = parsed.searchParams.get('sslmode');
        const isLocalHost = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(journalHost);
        if (isLocalHost && config.NODE_ENV !== 'test') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'Local account deletion journal database URLs are allowed only in test configuration.'
          });
        }
        if (config.NODE_ENV === 'production' && !isLocalHost && sslMode !== 'verify-full') {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: 'Production account deletion journal connections must use sslmode=verify-full.'
          });
        }
      } catch {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: 'The account deletion journal database URL is invalid.'
        });
      }
    }
    const isPlaceholder = config.JWT_SECRET.includes('replace-with');

    if (
      config.NODE_ENV === 'production' &&
      (config.JWT_SECRET === developmentJwtSecret || isPlaceholder)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_SECRET'],
        message: 'A real staging or production JWT_SECRET is required.'
      });
    }
    const paginationSecretIsPlaceholder =
      config.PAGINATION_CURSOR_SECRET === developmentPaginationCursorSecret ||
      config.PAGINATION_CURSOR_SECRET.includes('replace-with');

    if (config.NODE_ENV === 'production' && paginationSecretIsPlaceholder) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAGINATION_CURSOR_SECRET'],
        message: 'A real PAGINATION_CURSOR_SECRET is required in production.'
      });
    }

    if (config.PAGINATION_CURSOR_SECRET === config.JWT_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAGINATION_CURSOR_SECRET'],
        message: 'PAGINATION_CURSOR_SECRET must be independent from JWT_SECRET.'
      });
    }
  });

export const parseEnv = (values: NodeJS.ProcessEnv) => envSchema.parse(values);

export const env = parseEnv(process.env);
