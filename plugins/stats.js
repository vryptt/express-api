export default {
  name: "stats",
  description: "Get detailed server statistics including uptime, memory, and CPU load.",
  tags: ["server", "monitoring"],
  method: "get",
  path: "/stats",
  summary: "Server stats",
  operationId: "getServerStats",
  deprecated: false,
  externalDocs: {
    description: "Server monitoring docs",
    url: "https://example.com/docs/server"
  },
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: "verbose",
      in: "query",
      description: "Return detailed stats if true",
      required: false,
      schema: { type: "boolean", default: false }
    }
  ],
  requestBody: null,
  responses: {
    200: {
      description: "Server statistics",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              uptime: { type: "number", example: 12345 },
              memoryUsage: {
                type: "object",
                properties: {
                  rss: { type: "number" },
                  heapTotal: { type: "number" },
                  heapUsed: { type: "number" },
                  external: { type: "number" }
                }
              },
              cpuLoad: { type: "number", example: 0.42 },
              detailed: { type: "boolean" }
            }
          }
        }
      }
    },
    401: { description: "Unauthorized" }
  },
  callbacks: {
    onStatsChange: {
      "http://example.com/notify": {
        post: {
          description: "Callback for server stats changes",
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "object", properties: { uptime: { type: "number" } } }
              }
            }
          },
          responses: {
            200: { description: "Callback acknowledged" }
          }
        }
      }
    }
  },
  handler: (req, res) => {
    const verbose = req.query.verbose === "true";
    res.json({
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuLoad: Math.random(),
      detailed: verbose
    });
  }
};