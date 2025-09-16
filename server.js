import createApp from './app.js';
import { logger } from './lib/logger.js';
import { setServer } from './lib/graceful-shutdown.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  try {
    const app = await createApp();
    
    const server = app.listen(PORT, HOST, () => {
      logger.info(`Server running on ${HOST}:${PORT}`);
      logger.info(`API Documentation: http://${HOST}:${PORT}/docs`);
      logger.info(`Health Check: http://${HOST}:${PORT}/health`);
      logger.info(`OpenAPI Spec: http://${HOST}:${PORT}/openapi.json`);
    });
    
    setServer(server);
    
    server.on('error', (error) => {
      if (error.syscall !== 'listen') {
        throw error;
      }
      
      switch (error.code) {
        case 'EACCES':
          logger.error(`Port ${PORT} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          logger.error(`Port ${PORT} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();