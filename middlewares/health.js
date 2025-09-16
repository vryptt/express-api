import { logger } from '../lib/logger.js';

const startTime = Date.now();

export function healthCheck(req, res) {
  const healthStatus = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    startTime: new Date(startTime).toISOString(),
    memory: process.memoryUsage(),
    version: process.env.API_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid
  };
  
  const statusCode = healthStatus.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(healthStatus);
}