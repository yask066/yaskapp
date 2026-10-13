import 'dotenv/config';

import { z } from 'zod';

const developmentJwtSecret = 'development-only-secret';

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
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  ACCOUNT_DELETION_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  ACCOUNT_DELETION_JOURNAL_ENDPOINT: z.string().url().optional(),
  ACCOUNT_DELETION_JOURNAL_REGION: z.string().default('us-east-1'),
  ACCOUNT_DELETION_JOURNAL_BUCKET: z.string().min(1).optional(),
  ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID: z.string().min(1).optional(),
  ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  ACCOUNT_DELETION_JOURNAL_HMAC_KEY: z.string().min(32).optional(),
  FIREBASE_PROJECT_ID: z.string().min(1).optional()
  })
  .superRefine((config, context) => {
    const journalSettings = [
      config.ACCOUNT_DELETION_JOURNAL_ENDPOINT,
      config.ACCOUNT_DELETION_JOURNAL_BUCKET,
      config.ACCOUNT_DELETION_JOURNAL_ACCESS_KEY_ID,
      config.ACCOUNT_DELETION_JOURNAL_SECRET_ACCESS_KEY,
      config.ACCOUNT_DELETION_JOURNAL_HMAC_KEY
    ];
    if (journalSettings.some(Boolean) && journalSettings.some((value) => !value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_DELETION_JOURNAL_ENDPOINT'],
        message: 'All independent account deletion journal settings must be configured together.'
      });
    }
    if (config.ACCOUNT_DELETION_ENABLED && journalSettings.some((value) => !value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_DELETION_ENABLED'],
        message: 'Account deletion cannot be enabled without its independent durable journal.'
      });
    }
    if (
      config.ACCOUNT_DELETION_JOURNAL_ENDPOINT &&
      config.ACCOUNT_DELETION_JOURNAL_ENDPOINT === config.S3_ENDPOINT
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ACCOUNT_DELETION_JOURNAL_ENDPOINT'],
        message: 'The account deletion journal must use an independent object-storage endpoint.'
      });
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
  });

export const env = envSchema.parse(process.env);
