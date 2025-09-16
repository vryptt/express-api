import Joi from 'joi';
import { logger } from './logger.js';

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  API_TITLE: Joi.string().default('Advanced Modular API'),
  API_VERSION: Joi.string().default('1.0.0'),
  API_DESCRIPTION: Joi.string().default('Production-ready API'),
  CORS_ORIGINS: Joi.string().default('*'),
  TRUST_PROXY: Joi.number().default(1),
  JSON_LIMIT: Joi.string().default('10mb'),
  URL_ENCODED_LIMIT: Joi.string().default('10mb'),
  COMPRESSION_LEVEL: Joi.number().min(0).max(9).default(6),
  COOKIE_SECRET: Joi.string().required(),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  SERVE_STATIC: Joi.boolean().default(false),
  STATIC_MAX_AGE: Joi.string().default('1d')
}).unknown();

export function validateEnv() {
  const { error, value } = envSchema.validate(process.env);
  
  if (error) {
    logger.error('Environment validation failed:', error.details);
    throw new Error('Invalid environment configuration');
  }

  Object.assign(process.env, value);
  
  logger.info('Environment configuration validated successfully');
  return value;
}