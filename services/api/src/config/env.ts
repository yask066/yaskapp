import 'dotenv/config';

import { z } from 'zod';

const developmentJwtSecret = 'development-only-secret';

const envSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16).default(developmentJwtSecret),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true)
  })
  .superRefine((config, context) => {
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
