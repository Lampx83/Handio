import type { IncomingMessage, ServerResponse } from "node:http";
export function mockHandler(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void>;
