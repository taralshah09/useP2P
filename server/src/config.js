import { SESSION_TTL_MS } from 'shared/constants';

export const config = {
  port: process.env.PORT || 3001,
  sessionTtl: process.env.SESSION_TTL_MS || SESSION_TTL_MS,
  allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'],
  rateLimit: {
    joinAttemptsPerIp: 10, // within a window
    joinAttemptsPerCode: 5,
    windowMs: 60 * 1000 // 1 minute
  }
};
