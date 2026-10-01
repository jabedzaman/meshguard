// Every MCP tool declares whether it mutates state. Mutating tools require
// explicit user approval before they run.
export type ToolAccess = "read" | "mutate";

export interface ToolDefinition {
  name: string;
  description: string;
  access: ToolAccess;
}

export const tools = [
  { name: "list_devices", description: "List devices in the current network", access: "read" },
  { name: "get_device_status", description: "Get a device's connection status", access: "read" },
  { name: "switch_workspace", description: "Activate a workspace", access: "mutate" },
] as const satisfies readonly ToolDefinition[];
