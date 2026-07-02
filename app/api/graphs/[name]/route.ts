import { readFileSync } from "fs";
import { join } from "path";
import type { NextRequest } from "next/server";

const GRAPHS_DIR = join(process.cwd(), "graphs");

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/graphs/[name]">) {
  const { name } = await ctx.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(name))
    return Response.json({ error: "Invalid graph name" }, { status: 400 });
  try {
    return Response.json(JSON.parse(readFileSync(join(GRAPHS_DIR, `${name}.json`), "utf-8")));
  } catch {
    return Response.json({ error: "Graph not found" }, { status: 404 });
  }
}
