import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);

export class RouterPlugin {
  constructor(config = {}) {
    this.config = {
      title: config.title || 'API',
      version: config.version || '1.0.0',
      description: config.description || 'API Documentation',
      servers: config.servers || [{ url: 'http://localhost:3000', description: 'Local server' }],
      contact: config.contact || {},
      license: config.license || { name: 'MIT' },
      ...config
    };
    
    this.router = Router();
    this.routes = new Map();
    this.middlewares = new Map();
    this.plugins = new Map();
    this.openApiSpec = this.initializeOpenApiSpec();
  }

  initializeOpenApiSpec() {
    return {
      openapi: '3.0.0',
      info: {
        title: this.config.title,
        version: this.config.version,
        description: this.config.description,
        contact: this.config.contact,
        license: this.config.license
      },
      servers: this.config.servers,
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key'
          }
        },
        responses: {
          UnauthorizedError: {
            description: 'Access token is missing or invalid',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          NotFoundError: {
            description: 'Resource not found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          },
          ValidationError: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string' },
                    message: { type: 'string' },
                    details: {
                      type: 'array',
                      items: { type: 'object' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      tags: []
    };
  }

  async loadRoutesFromDir(dirPath) {
    try {
      const files = await this.getJsFiles(dirPath);
      const loadPromises = files.map(file => this.loadRouteFile(file));
      
      const results = await Promise.allSettled(loadPromises);
      
      let successCount = 0;
      let errorCount = 0;
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else {
          errorCount++;
          logger.error(`Failed to load route file ${files[index]}:`, result.reason);
        }
      });
      
      logger.info(`Route loading completed: ${successCount} successful, ${errorCount} failed`);
      
      if (errorCount > 0) {
        throw new Error(`Failed to load ${errorCount} route files`);
      }
      
    } catch (error) {
      logger.error('Error loading routes from directory:', error);
      throw error;
    }
  }

  async getJsFiles(dirPath) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.isDirectory()) {
          const subFiles = await this.getJsFiles(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      logger.warn(`Directory not found: ${dirPath}`);
    }
    
    return files;
  }

  async loadRouteFile(filePath) {
    try {
      const fileUrl = `file://${path.resolve(filePath)}?t=${Date.now()}`;
      const module = await import(fileUrl);
      
      const routeConfig = module.default || module;
      
      if (typeof routeConfig === 'function') {
        await this.registerFunctionRoute(routeConfig, filePath);
      } else if (typeof routeConfig === 'object') {
        await this.registerObjectRoute(routeConfig, filePath);
      } else {
        throw new Error(`Invalid route export type: ${typeof routeConfig}`);
      }
      
      logger.debug(`Successfully loaded route: ${filePath}`);
      
    } catch (error) {
      logger.error(`Failed to load route file ${filePath}:`, error);
      throw error;
    }
  }

  async registerFunctionRoute(routeFunction, filePath) {
    const routeRouter = Router();
    await routeFunction(routeRouter, { logger, config: this.config });
    
    const routeName = this.extractRouteName(filePath);
    this.routes.set(routeName, {
      router: routeRouter,
      filePath,
      type: 'function'
    });
    
    this.router.use(routeRouter);
  }

  async registerObjectRoute(routeConfig, filePath) {
    const {
      path: routePath = '/',
      method = 'get',
      handler,
      middlewares = [],
      validate,
      openapi,
      plugin
    } = routeConfig;

    if (!handler || typeof handler !== 'function') {
      throw new Error('Route handler must be a function');
    }

    const routeRouter = Router();
    const routeName = this.extractRouteName(filePath);
    
    const allMiddlewares = [
      ...this.getGlobalMiddlewares(),
      ...middlewares,
      ...(validate ? [this.createValidationMiddleware(validate)] : [])
    ];

    if (plugin) {
      await this.registerPlugin(plugin, routeName);
    }

    const methods = Array.isArray(method) ? method : [method];
    
    methods.forEach(m => {
      const methodLower = m.toLowerCase();
      
      if (!routeRouter[methodLower]) {
        throw new Error(`Invalid HTTP method: ${m}`);
      }
      
      routeRouter[methodLower](routePath, ...allMiddlewares, handler);
      
      if (openapi) {
        this.addOpenApiPath(routePath, methodLower, openapi, validate);
      }
    });

    this.routes.set(routeName, {
      router: routeRouter,
      filePath,
      config: routeConfig,
      type: 'object'
    });

    this.router.use(routeRouter);
  }

  async registerPlugin(pluginConfig, routeName) {
    const {
      name,
      version = '1.0.0',
      dependencies = [],
      initialize,
      middleware,
      routes
    } = pluginConfig;

    if (!name) {
      throw new Error('Plugin must have a name');
    }

    for (const dep of dependencies) {
      if (!this.plugins.has(dep)) {
        throw new Error(`Plugin dependency not found: ${dep}`);
      }
    }

    if (initialize && typeof initialize === 'function') {
      await initialize({ config: this.config, logger });
    }

    if (middleware) {
      this.registerMiddleware(`${name}_middleware`, middleware);
    }

    if (routes && Array.isArray(routes)) {
      for (const route of routes) {
        await this.registerObjectRoute(route, `plugin:${name}`);
      }
    }

    this.plugins.set(name, {
      name,
      version,
      dependencies,
      routeName
    });

    logger.info(`Plugin registered: ${name}@${version}`);
  }

  createValidationMiddleware(validate) {
    return (req, res, next) => {
      const errors = [];
      
      if (validate.body && req.body) {
        const result = this.validateSchema(req.body, validate.body);
        if (result.error) errors.push(...result.error.details);
      }
      
      if (validate.params && req.params) {
        const result = this.validateSchema(req.params, validate.params);
        if (result.error) errors.push(...result.error.details);
      }
      
      if (validate.query && req.query) {
        const result = this.validateSchema(req.query, validate.query);
        if (result.error) errors.push(...result.error.details);
      }
      
      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Request validation failed',
          details: errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        });
      }
      
      next();
    };
  }

  validateSchema(data, schema) {
    if (schema.validate && typeof schema.validate === 'function') {
      return schema.validate(data);
    }
    
    return { error: null };
  }

  addOpenApiPath(path, method, openapi, validate) {
    if (!this.openApiSpec.paths[path]) {
      this.openApiSpec.paths[path] = {};
    }

    const pathSpec = {
      ...openapi,
      parameters: openapi.parameters || []
    };

    if (validate) {
      if (validate.body) {
        pathSpec.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: this.convertValidationToSchema(validate.body)
            }
          }
        };
      }

      if (validate.params || validate.query) {
        const params = [];
        
        if (validate.params) {
          params.push(...this.convertParamsToOpenApi(validate.params, 'path'));
        }
        
        if (validate.query) {
          params.push(...this.convertParamsToOpenApi(validate.query, 'query'));
        }
        
        pathSpec.parameters = [...pathSpec.parameters, ...params];
      }
    }

    if (openapi.tags) {
      openapi.tags.forEach(tag => {
        if (!this.openApiSpec.tags.find(t => t.name === tag)) {
          this.openApiSpec.tags.push({ name: tag });
        }
      });
    }

    this.openApiSpec.paths[path][method] = pathSpec;
  }

  convertValidationToSchema(validation) {
    if (validation._type) {
      return { type: validation._type };
    }
    
    return { type: 'object' };
  }

  convertParamsToOpenApi(validation, paramType) {
    const params = [];
    
    if (validation._ids && validation._ids._byKey) {
      Object.keys(validation._ids._byKey).forEach(key => {
        params.push({
          name: key,
          in: paramType,
          required: paramType === 'path',
          schema: { type: 'string' }
        });
      });
    }
    
    return params;
  }

  registerMiddleware(name, middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    
    this.middlewares.set(name, middleware);
    logger.debug(`Middleware registered: ${name}`);
  }

  getGlobalMiddlewares() {
    return Array.from(this.middlewares.values());
  }

  extractRouteName(filePath) {
    const basename = path.basename(filePath, path.extname(filePath));
    return basename.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  getRouter() {
    return this.router;
  }

  getSpec() {
    return this.openApiSpec;
  }

  getRoutesCount() {
    return this.routes.size;
  }

  getPluginsCount() {
    return this.plugins.size;
  }

  getMiddlewaresCount() {
    return this.middlewares.size;
  }

  getRouteInfo(routeName) {
    return this.routes.get(routeName);
  }

  getPluginInfo(pluginName) {
    return this.plugins.get(pluginName);
  }

  listRoutes() {
    const routeList = [];
    
    this.routes.forEach((route, name) => {
      routeList.push({
        name,
        filePath: route.filePath,
        type: route.type,
        hasConfig: !!route.config
      });
    });
    
    return routeList;
  }

  listPlugins() {
    const pluginList = [];
    
    this.plugins.forEach((plugin, name) => {
      pluginList.push({
        name: plugin.name,
        version: plugin.version,
        dependencies: plugin.dependencies,
        routeName: plugin.routeName
      });
    });
    
    return pluginList;
  }

  async reloadRoute(routeName) {
    const route = this.routes.get(routeName);
    if (!route) {
      throw new Error(`Route not found: ${routeName}`);
    }
    
    try {
      await this.loadRouteFile(route.filePath);
      logger.info(`Route reloaded: ${routeName}`);
    } catch (error) {
      logger.error(`Failed to reload route ${routeName}:`, error);
      throw error;
    }
  }

  removeRoute(routeName) {
    const route = this.routes.get(routeName);
    if (!route) {
      throw new Error(`Route not found: ${routeName}`);
    }
    
    this.routes.delete(routeName);
    logger.info(`Route removed: ${routeName}`);
  }

  addSchema(name, schema) {
    this.openApiSpec.components.schemas[name] = schema;
  }

  getHealthInfo() {
    return {
      routes: this.getRoutesCount(),
      plugins: this.getPluginsCount(),
      middlewares: this.getMiddlewaresCount(),
      status: 'healthy'
    };
  }
}