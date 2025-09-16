import { logger } from './logger.js';

let server = null;
let isShuttingDown = false;

export function setServer(serverInstance) {
  server = serverInstance;
}

export function gracefulShutdown(signal = 'SIGTERM') {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 30000);
  
  if (server) {
    server.close((err) => {
      clearTimeout(shutdownTimeout);
      
      if (err) {
        logger.error('Error during server shutdown:', err);
        process.exit(1);
      }
      
      logger.info('Server closed successfully');
      process.exit(0);
    });
  } else {
    clearTimeout(shutdownTimeout);
    logger.info('No server instance to close');
    process.exit(0);
  }
}