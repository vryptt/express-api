import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { logger } from './logger.js';

const require = createRequire(import.meta.url);

let config = {};
try {
  const configPath = path.join(process.cwd(), 'config.json');
  const configFile = await fs.readFile(configPath, 'utf8');
  config = JSON.parse(configFile);
} catch (error) {
  logger.warn('Failed to load config.json, using defaults:', error.message);
  config = {
    title: 'API',
    version: '1.0.0',
    description: 'API Documentation',
    servers: [{ url: 'http://localhost:3000', description: 'Local server' }],
    contact: {},
    license: { name: 'MIT' },
    autoGenerateSpec: false
  };
}

// Global state variables
const router = Router();
const routes = new Map();
const middlewares = new Map();
const plugins = new Map();
const routeStack = [];

// Initialize OpenAPI specification
let openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: config.title,
    version: config.version,
    description: config.description,
    contact: config.contact,
    license: config.license
  },
  servers: config.servers,
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

// Auto-generate OpenAPI spec from registered routes
function autoGenerateOpenApiSpec() {
  const existingPaths = { ...openApiSpec.paths };
  openApiSpec.paths = {};

  // Re-add manually configured paths
  Object.keys(existingPaths).forEach(pathKey => {
    Object.keys(existingPaths[pathKey]).forEach(method => {
      if (existingPaths[pathKey][method].customSpec) {
        if (!openApiSpec.paths[pathKey]) {
          openApiSpec.paths[pathKey] = {};
        }
        openApiSpec.paths[pathKey][method] = existingPaths[pathKey][method];
      }
    });
  });

  // Generate specs for routes in routeStack
  routeStack.forEach(route => {
    if (!openApiSpec.paths[route.path]) {
      openApiSpec.paths[route.path] = {};
    }

    if (!openApiSpec.paths[route.path][route.method]) {
      const methodUpper = route.method.toUpperCase();
      const pathSegments = route.path.split('/').filter(p => p);
      const resource = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1] : 'resource';

      openApiSpec.paths[route.path][route.method] = {
        summary: generateSummary(methodUpper, resource),
        description: generateDescription(methodUpper, resource),
        tags: [generateTagFromPath(route.path)],
        parameters: extractParameters(route.path),
        responses: generateDefaultResponses(methodUpper)
      };

      // Add security if route requires auth
      if (requiresAuth(route.path)) {
        openApiSpec.paths[route.path][route.method].security = [
          { bearerAuth: [] },
          { apiKeyAuth: [] }
        ];
      }

      // Add request body for POST, PUT, PATCH
      if (['post', 'put', 'patch'].includes(route.method)) {
        openApiSpec.paths[route.path][route.method].requestBody = {
          description: `${resource} data`,
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: `${resource} object`
              }
            }
          }
        };
      }
    }
  });

  logger.debug('OpenAPI spec auto-generated');
}

// Generate summary for route
function generateSummary(method, resource) {
  const summaries = {
    GET: `Get ${resource}`,
    POST: `Create ${resource}`,
    PUT: `Update ${resource}`,
    PATCH: `Partially update ${resource}`,
    DELETE: `Delete ${resource}`
  };
  
  return summaries[method] || `${method} ${resource}`;
}

// Generate description for route
function generateDescription(method, resource) {
  const descriptions = {
    GET: `Retrieve ${resource} items`,
    POST: `Create a new ${resource} with the provided data`,
    PUT: `Update an existing ${resource} with new data`,
    PATCH: `Partially update an existing ${resource}`,
    DELETE: `Remove an existing ${resource}`
  };
  
  return descriptions[method] || `Perform ${method} operation on ${resource}`;
}

// Extract parameters from path
function extractParameters(path) {
  const parameters = [];
  const paramMatches = path.match(/{([^}]+)}/g);
  
  if (paramMatches) {
    paramMatches.forEach(param => {
      const paramName = param.slice(1, -1); // Remove { }
      parameters.push({
        name: paramName,
        in: 'path',
        required: true,
        description: `${paramName} identifier`,
        schema: {
          type: paramName.includes('id') || paramName.includes('Id') ? 'integer' : 'string'
        }
      });
    });
  }
  
  return parameters;
}

// Generate tag from path
function generateTagFromPath(path) {
  const pathParts = path.split('/').filter(p => p && !p.startsWith('{'));
  if (pathParts.length === 0) return 'General';
  
  const resource = pathParts[pathParts.length - 1];
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

// Generate default responses based on method
function generateDefaultResponses(method) {
  const commonResponses = {
    '400': { $ref: '#/components/responses/ValidationError' },
    '500': {
      description: 'Internal server error',
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
    }
  };

  const methodResponses = {
    GET: {
      '200': {
        description: 'Successful response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Response data'
            }
          }
        }
      },
      '404': { $ref: '#/components/responses/NotFoundError' },
      ...commonResponses
    },
    POST: {
      '201': {
        description: 'Resource created successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Created resource data'
            }
          }
        }
      },
      ...commonResponses
    },
    PUT: {
      '200': {
        description: 'Resource updated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Updated resource data'
            }
          }
        }
      },
      '404': { $ref: '#/components/responses/NotFoundError' },
      ...commonResponses
    },
    PATCH: {
      '200': {
        description: 'Resource partially updated successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Updated resource data'
            }
          }
        }
      },
      '404': { $ref: '#/components/responses/NotFoundError' },
      ...commonResponses
    },
    DELETE: {
      '204': {
        description: 'Resource deleted successfully'
      },
      '404': { $ref: '#/components/responses/NotFoundError' },
      ...commonResponses
    }
  };

  return methodResponses[method] || methodResponses.GET;
}

// Check if route requires authentication
function requiresAuth(path) {
  const publicPaths = config.publicPaths || ['/health', '/docs', '/openapi', '/ping'];
  return !publicPaths.some(publicPath => path.startsWith(publicPath));
}

// Load routes from directory
async function loadRoutesFromDir(dirPath) {
  try {
    const files = await getJsFiles(dirPath);
    const loadPromises = files.map(file => loadRouteFile(file));
    
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

// Get JavaScript files from directory
async function getJsFiles(dirPath) {
  const files = [];
  
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        const subFiles = await getJsFiles(fullPath);
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

// Load route file
async function loadRouteFile(filePath) {
  try {
    const fileUrl = `file://${path.resolve(filePath)}?t=${Date.now()}`;
    const module = await import(fileUrl);
    
    const routeConfig = module.default || module;
    
    if (typeof routeConfig === 'function') {
      await registerFunctionRoute(routeConfig, filePath);
    } else if (typeof routeConfig === 'object') {
      await registerObjectRoute(routeConfig, filePath);
    } else {
      throw new Error(`Invalid route export type: ${typeof routeConfig}`);
    }
    
    logger.debug(`Successfully loaded route: ${filePath}`);
    
  } catch (error) {
    logger.error(`Failed to load route file ${filePath}:`, error);
    throw error;
  }
}

// Register function route
async function registerFunctionRoute(routeFunction, filePath) {
  const routeRouter = Router();
  await routeFunction(routeRouter, { logger, config });

  const routeName = extractRouteName(filePath);
  routes.set(routeName, { router: routeRouter, filePath, type: 'function' });
  router.use(routeRouter);

  // Scan semua layer di router
  routeRouter.stack.forEach(layer => {
    if (layer.route) {
      const path = layer.route.path;
      const methods = Object.keys(layer.route.methods);
      methods.forEach(m => {
        routeStack.push({ path, method: m, routeName });
      });
    }
  });

  autoGenerateOpenApiSpec();
}

// Register object route
async function registerObjectRoute(routeConfig, filePath) {
  const {
    path: routePath = '/',
    method = 'get',
    handler,
    middlewares: routeMiddlewares = [],
    validate,
    openapi,
    plugin
  } = routeConfig;

  if (!handler || typeof handler !== 'function') {
    throw new Error('Route handler must be a function');
  }

  const routeRouter = Router();
  const routeName = extractRouteName(filePath);
  
  const allMiddlewares = [
    ...getGlobalMiddlewares(),
    ...routeMiddlewares,
    ...(validate ? [createValidationMiddleware(validate)] : [])
  ];

  if (plugin) {
    await registerPlugin(plugin, routeName);
  }

  const methods = Array.isArray(method) ? method : [method];
  
  methods.forEach(m => {
    const methodLower = m.toLowerCase();
    
    if (!routeRouter[methodLower]) {
      throw new Error(`Invalid HTTP method: ${m}`);
    }
    
    routeRouter[methodLower](routePath, ...allMiddlewares, handler);
    
    // Store route info for auto-generation
    routeStack.push({
      path: routePath,
      method: methodLower,
      routeName,
      config: routeConfig
    });
    
    if (openapi) {
      addOpenApiPath(routePath, methodLower, openapi, validate);
    }

    // Auto-generate OpenAPI spec setiap kali route didaftarkan
    autoGenerateOpenApiSpec();
  });

  routes.set(routeName, {
    router: routeRouter,
    filePath,
    config: routeConfig,
    type: 'object'
  });

  router.use(routeRouter);
}

// Register plugin
async function registerPlugin(pluginConfig, routeName) {
  const {
    name,
    version = '1.0.0',
    dependencies = [],
    initialize,
    middleware,
    routes: pluginRoutes
  } = pluginConfig;

  if (!name) {
    throw new Error('Plugin must have a name');
  }

  for (const dep of dependencies) {
    if (!plugins.has(dep)) {
      throw new Error(`Plugin dependency not found: ${dep}`);
    }
  }

  if (initialize && typeof initialize === 'function') {
    await initialize({ config, logger });
  }

  if (middleware) {
    registerMiddleware(`${name}_middleware`, middleware);
  }

  if (pluginRoutes && Array.isArray(pluginRoutes)) {
    for (const route of pluginRoutes) {
      await registerObjectRoute(route, `plugin:${name}`);
    }
  }

  plugins.set(name, {
    name,
    version,
    dependencies,
    routeName
  });

  logger.info(`Plugin registered: ${name}@${version}`);
}

// Create validation middleware
function createValidationMiddleware(validate) {
  return (req, res, next) => {
    const errors = [];
    
    if (validate.body && req.body) {
      const result = validateSchema(req.body, validate.body);
      if (result.error) errors.push(...result.error.details);
    }
    
    if (validate.params && req.params) {
      const result = validateSchema(req.params, validate.params);
      if (result.error) errors.push(...result.error.details);
    }
    
    if (validate.query && req.query) {
      const result = validateSchema(req.query, validate.query);
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

// Validate schema
function validateSchema(data, schema) {
  if (schema.validate && typeof schema.validate === 'function') {
    return schema.validate(data);
  }
  
  return { error: null };
}

// Add OpenAPI path
function addOpenApiPath(path, method, openapi, validate) {
  if (!openApiSpec.paths[path]) {
    openApiSpec.paths[path] = {};
  }

  const pathSpec = {
    ...openapi,
    parameters: openapi.parameters || [],
    customSpec: true // Mark as manually configured
  };

  if (validate) {
    if (validate.body) {
      pathSpec.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: convertValidationToSchema(validate.body)
          }
        }
      };
    }

    if (validate.params || validate.query) {
      const params = [];
      
      if (validate.params) {
        params.push(...convertParamsToOpenApi(validate.params, 'path'));
      }
      
      if (validate.query) {
        params.push(...convertParamsToOpenApi(validate.query, 'query'));
      }
      
      pathSpec.parameters = [...pathSpec.parameters, ...params];
    }
  }

  if (openapi.tags) {
    openapi.tags.forEach(tag => {
      if (!openApiSpec.tags.find(t => t.name === tag)) {
        openApiSpec.tags.push({ name: tag });
      }
    });
  }

  openApiSpec.paths[path][method] = pathSpec;
}

// Convert validation to schema
function convertValidationToSchema(validation) {
  if (validation._type) {
    return { type: validation._type };
  }
  
  return { type: 'object' };
}

// Convert params to OpenAPI
function convertParamsToOpenApi(validation, paramType) {
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

// Register middleware
function registerMiddleware(name, middleware) {
  if (typeof middleware !== 'function') {
    throw new Error('Middleware must be a function');
  }
  
  middlewares.set(name, middleware);
  logger.debug(`Middleware registered: ${name}`);
}

// Get global middlewares
function getGlobalMiddlewares() {
  return Array.from(middlewares.values());
}

// Extract route name from file path
function extractRouteName(filePath) {
  const basename = path.basename(filePath, path.extname(filePath));
  return basename.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Generate OpenAPI spec manually
function generateOpenApiSpec() {
  logger.debug('routeStack:', routeStack);
  autoGenerateOpenApiSpec();
  return openApiSpec;
}

// Debug router structure
function debugRouterStructure(routerToDebug = router, depth = 0) {
  const indent = '  '.repeat(depth);
  logger.debug(`${indent}Router Debug (depth: ${depth}):`);
  
  if (!routerToDebug || !routerToDebug.stack) {
    logger.debug(`${indent}  No stack found`);
    return;
  }
  
  logger.debug(`${indent}  Stack length: ${routerToDebug.stack.length}`);
  
  routerToDebug.stack.forEach((layer, index) => {
    logger.debug(`${indent}  Layer ${index}:`);
    logger.debug(`${indent}    Name: ${layer.name || 'anonymous'}`);
    logger.debug(`${indent}    Regexp: ${layer.regexp ? layer.regexp.source : 'none'}`);
    
    if (layer.route) {
      logger.debug(`${indent}    Route path: ${layer.route.path}`);
      logger.debug(`${indent}    Methods: ${JSON.stringify(layer.route.methods)}`);
    } else if (layer.name === 'router' && layer.handle) {
      logger.debug(`${indent}    Nested router found`);
      if (depth < 3) { // Prevent infinite recursion
        debugRouterStructure(layer.handle, depth + 1);
      }
    }
  });
}

// Add route directly
function addRoute(routeConfig) {
  const {
    path: routePath,
    method = 'GET',
    handler,
    middlewares: routeMiddlewares = [],
    openapi
  } = routeConfig;
  
  if (!routePath || !handler) {
    throw new Error('Route path and handler are required');
  }
  
  const methods = Array.isArray(method) ? method : [method];
  
  methods.forEach(m => {
    const methodLower = m.toLowerCase();
    
    // Add to Express router
    if (router[methodLower]) {
      router[methodLower](routePath, ...routeMiddlewares, handler);
      
      // Store for auto-generation
      routeStack.push({
        path: routePath,
        method: methodLower,
        routeName: `manual_${Date.now()}`,
        config: routeConfig
      });
      
      // Add to OpenAPI spec if provided
      if (openapi) {
        addOpenApiPath(routePath, methodLower, openapi);
      }
      
      logger.debug(`Manual route added: ${methodLower.toUpperCase()} ${routePath}`);

      // Auto-generate OpenAPI spec setelah setiap route manual
      autoGenerateOpenApiSpec();
    }
  });
  
  return { success: true };
}

// Export OpenAPI spec to file
async function exportOpenApiSpec(outputPath) {
  try {
    const specJson = JSON.stringify(openApiSpec, null, 2);
    await fs.writeFile(outputPath, specJson, 'utf8');
    logger.info(`OpenAPI spec exported to: ${outputPath}`);
    return outputPath;
  } catch (error) {
    logger.error('Failed to export OpenAPI spec:', error);
    throw error;
  }
}

// Reload route
async function reloadRoute(routeName) {
  const route = routes.get(routeName);
  if (!route) {
    throw new Error(`Route not found: ${routeName}`);
  }
  
  try {
    await loadRouteFile(route.filePath);
    
    // Re-generate OpenAPI spec after reload
    autoGenerateOpenApiSpec();
    
    logger.info(`Route reloaded: ${routeName}`);
  } catch (error) {
    logger.error(`Failed to reload route ${routeName}:`, error);
    throw error;
  }
}

// Remove route
function removeRoute(routeName) {
  const route = routes.get(routeName);
  if (!route) {
    throw new Error(`Route not found: ${routeName}`);
  }
  
  routes.delete(routeName);
  
  // Remove from route stack
  const updatedStack = routeStack.filter(r => r.routeName !== routeName);
  routeStack.length = 0;
  routeStack.push(...updatedStack);
  
  // Re-generate OpenAPI spec after removal
  autoGenerateOpenApiSpec();
  
  logger.info(`Route removed: ${routeName}`);
}

// Add schema
function addSchema(name, schema) {
  openApiSpec.components.schemas[name] = schema;
}

// Get router
function getRouter() {
  return router;
}

// Get OpenAPI spec
function getSpec() {
  return openApiSpec;
}

// Get counts
function getRoutesCount() {
  return routes.size;
}

function getPluginsCount() {
  return plugins.size;
}

function getMiddlewaresCount() {
  return middlewares.size;
}

// Get info
function getRouteInfo(routeName) {
  return routes.get(routeName);
}

function getPluginInfo(pluginName) {
  return plugins.get(pluginName);
}

// List functions
function listRoutes() {
  const routeList = [];
  
  routes.forEach((route, name) => {
    routeList.push({
      name,
      filePath: route.filePath,
      type: route.type,
      hasConfig: !!route.config
    });
  });
  
  return routeList;
}

function listPlugins() {
  const pluginList = [];
  
  plugins.forEach((plugin, name) => {
    pluginList.push({
      name: plugin.name,
      version: plugin.version,
      dependencies: plugin.dependencies,
      routeName: plugin.routeName
    });
  });
  
  return pluginList;
}

// Get health info
function getHealthInfo() {
  return {
    routes: getRoutesCount(),
    plugins: getPluginsCount(),
    middlewares: getMiddlewaresCount(),
    openApiPaths: Object.keys(openApiSpec.paths).length,
    status: 'healthy'
  };
}

export {
  loadRoutesFromDir,
  getJsFiles,
  loadRouteFile,
  registerFunctionRoute,
  registerObjectRoute,
  registerPlugin,
  createValidationMiddleware,
  validateSchema,
  addOpenApiPath,
  convertValidationToSchema,
  convertParamsToOpenApi,
  registerMiddleware,
  getGlobalMiddlewares,
  extractRouteName,
  generateOpenApiSpec,
  debugRouterStructure,
  addRoute,
  exportOpenApiSpec,
  reloadRoute,
  removeRoute,
  addSchema,
  getRouter,
  getSpec,
  getRoutesCount,
  getPluginsCount,
  getMiddlewaresCount,
  getRouteInfo,
  getPluginInfo,
  listRoutes,
  listPlugins,
  getHealthInfo,
  autoGenerateOpenApiSpec,
  generateSummary,
  generateDescription,
  extractParameters,
  generateTagFromPath,
  generateDefaultResponses,
  requiresAuth,
  config
};