# Express API

A production-ready, modular Express.js API with plugin-based architecture, comprehensive security, and advanced features.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![Express](https://img.shields.io/badge/Express-4.18%2B-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)
![Build](https://img.shields.io/badge/Build-Passing-brightgreen)

## Features

### Core Features
- **Plugin-based Architecture**: Modular route system with auto-discovery
- **Production-ready Security**: Helmet, CORS, rate limiting, and security headers
- **Advanced Rate Limiting**: Multiple strategies with user-based tracking
- **Comprehensive Logging**: Winston with daily rotation and structured logging
- **Health Monitoring**: Built-in health checks and system metrics
- **API Documentation**: Auto-generated OpenAPI 3.0 specification with Swagger UI
- **Environment Validation**: Type-safe configuration with Joi
- **Graceful Shutdown**: Proper cleanup and signal handling

### Security Features
- CSP (Content Security Policy) headers
- XSS protection and CSRF mitigation
- Request ID tracking for debugging
- Multiple rate limiting strategies
- Security-first middleware stack

### Developer Experience
- Hot reload support for routes
- Comprehensive error handling
- Request/response validation
- Plugin system with dependencies
- Structured logging with context
- Environment-based configuration

## Quick Start

### Prerequisites
- Node.js 18 or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/vryptt/express-api.git
cd express-api
```

2. Install dependencies:
```bash
npm install express helmet cors compression cookie-parser morgan express-rate-limit express-slow-down winston winston-daily-rotate-file joi uuid
```

3. Setup environment variables:
```bash
cp .env.example .env
```

4. Edit your `.env` file with appropriate values:
```env
NODE_ENV=development
PORT=3000
COOKIE_SECRET=your-super-secret-key
CORS_ORIGINS=http://localhost:3000
```

5. Start the development server:
```bash
npm run dev
```

### Development Dependencies (Optional)
```bash
npm install --save-dev nodemon eslint prettier
```

## Project Structure

```
express-api/
├── lib/
│   ├── handler.js          # RouterPlugin system
│   ├── logger.js           # Winston logging configuration
│   ├── config.js           # Environment validation
│   └── graceful-shutdown.js # Process management
├── middlewares/
│   ├── errorHandler.js     # Global error handling
│   ├── health.js           # Health check middleware
│   ├── requestId.js        # Request tracking
│   ├── security.js         # Security headers
│   └── metrics.js          # Performance metrics
├── plugins/
│   └── routes/             # Auto-loaded route files
│       ├── users.js        # User management routes
│       ├── auth.js         # Authentication routes
│       ├── products.js     # Product CRUD routes
│       └── admin/
│           └── dashboard.js # Admin dashboard
├── logs/                   # Application logs (auto-created)
├── app.js                  # Express app configuration
├── server.js               # Server entry point
├── .env.example            # Environment variables template
└── .gitignore             # Git ignore patterns
```

## API Endpoints

### Core Endpoints
- `GET /` - API information and status
- `GET /health` - Health check endpoint
- `GET /docs` - Interactive API documentation (Swagger UI)
- `GET /openapi.json` - OpenAPI specification

### Authentication
- `POST /api/auth/login` - User authentication
- `POST /api/auth/register` - User registration

### User Management
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user by ID

### Products
- `GET /api/products` - List products
- `POST /api/products` - Create new product

### Admin (Protected)
- `GET /api/admin/dashboard` - Admin dashboard data

## Plugin System

The RouterPlugin system supports multiple route definition patterns:

### Function-based Routes
```javascript
// plugins/routes/example.js
export default async function(router, { logger, config }) {
  router.get('/example', (req, res) => {
    res.json({ message: 'Hello from function route!' });
  });
}
```

### Object-based Routes with Validation
```javascript
// plugins/routes/validated.js
import Joi from 'joi';

export default {
  path: '/api/example',
  method: 'post',
  validate: {
    body: Joi.object({
      name: Joi.string().required(),
      email: Joi.string().email().required()
    })
  },
  openapi: {
    tags: ['Example'],
    summary: 'Create example',
    responses: {
      201: { description: 'Created successfully' }
    }
  },
  handler: async (req, res) => {
    res.status(201).json({ success: true });
  }
};
```

### Plugin-based Routes
```javascript
// plugins/routes/plugin-example.js
export default {
  plugin: {
    name: 'example-plugin',
    version: '1.0.0',
    initialize: async ({ logger }) => {
      logger.info('Plugin initialized');
    }
  },
  path: '/api/plugin-example',
  method: 'get',
  handler: async (req, res) => {
    res.json({ plugin: 'active' });
  }
};
```

## Configuration

### Environment Variables

Key environment variables (see `.env.example` for complete list):

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | Server port | `3000` |
| `COOKIE_SECRET` | Cookie encryption key | Required |
| `CORS_ORIGINS` | Allowed CORS origins | `*` |
| `LOG_LEVEL` | Logging level | `info` |
| `JSON_LIMIT` | JSON payload limit | `10mb` |

### Rate Limiting

- **General API**: 100 requests per 15 minutes
- **Authentication**: 5 attempts per 15 minutes
- **Admin endpoints**: 20 requests per 15 minutes
- **Speed limiting**: Gradual slowdown when approaching limits

## Logging

Winston-based logging with:
- Daily log rotation
- Separate error logs
- Structured JSON logging in production
- Console output in development
- Request ID tracking

Log files are stored in the `logs/` directory:
- `app-YYYY-MM-DD.log` - General application logs
- `error-YYYY-MM-DD.log` - Error-only logs

## Health Monitoring

Health endpoint (`/health`) provides:
- Server uptime
- Memory usage
- Process information
- Environment details
- Service status

## Security Features

- **Helmet**: Security headers and CSP
- **CORS**: Configurable cross-origin resource sharing
- **Rate Limiting**: Multiple strategies with user tracking
- **Request Validation**: Joi-based input validation
- **Security Headers**: XSS protection, content type sniffing prevention
- **Cookie Security**: Secure cookie handling
- **Process Security**: Graceful shutdown and error handling

## Development

### Running in Development
```bash
npm run dev
```

### Running in Production
```bash
npm start
```

### Adding New Routes

1. Create a new file in `plugins/routes/`
2. Export your route configuration
3. The system will auto-discover and load it

### Environment Setup

1. Copy `.env.example` to `.env`
2. Modify values as needed
3. Ensure `COOKIE_SECRET` is set

## API Documentation

Interactive API documentation is available at `/docs` when running the server. The OpenAPI specification is automatically generated from route configurations.

## Error Handling

Comprehensive error handling includes:
- Global error middleware
- Structured error responses
- Request validation errors
- 404 handling for unknown routes
- Process-level error handling

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support and questions:
- Create an issue on [GitHub](https://github.com/vryptt/express-api/issues)
- Check the documentation at `/docs` when running the server
- Review the health status at `/health`

## Acknowledgments

- Built with Express.js and modern Node.js practices
- Inspired by production-ready API requirements
- Security best practices implemented throughout