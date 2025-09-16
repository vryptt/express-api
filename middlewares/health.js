import { logger } from '../lib/logger.js';
import { getHealthInfo } from '../lib/handler.js'

const startTime = Date.now();

export function healthCheck(req, res) {
  const info = getHealthInfo()
  res.status(200).json({ info });
}