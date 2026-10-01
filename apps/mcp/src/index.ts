import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "mesh", version: "0.0.0" });

server.registerTool(
  "list_devices",
  {
    description: "List devices in the current network",
    annotations: { readOnlyHint: true },
  },
  async () => ({
    content: [{ type: "text", text: "Not implemented yet: the agent API is not wired up." }],
  }),
);

await server.connect(new StdioServerTransport());
