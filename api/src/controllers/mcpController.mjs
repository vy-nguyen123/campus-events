import { toNodeHandler } from '@modelcontextprotocol/node';
import { mcpHandler } from '../mcp/server.mjs';

const handleRequest = toNodeHandler(mcpHandler);

export async function mcp(req, res) {
  await handleRequest(req, res, req.body);
}
