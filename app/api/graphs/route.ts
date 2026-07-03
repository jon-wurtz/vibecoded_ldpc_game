import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const GRAPHS_DIR = join(process.cwd(), "graphs");

export async function GET() {
  let files: string[];
  try {
    files = readdirSync(GRAPHS_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return Response.json([]);
  }
  const list = files.map((filename) => {
    const d = JSON.parse(readFileSync(join(GRAPHS_DIR, filename), "utf-8"));
    return {
      id: d.id as string,
      name: d.name as string,
      logicalBits: (d.G as number[][]).length,
      checkNodes: d.checkNodes as string[],
      dataNodes: d.dataNodes as string[],
      edges: d.edges as [string, string][],
      positions: d.positions as Record<string, { x: number; y: number }>,
      xCheckNodes: (d.xCheckNodes || []) as string[],
      zCheckNodes: (d.zCheckNodes || []) as string[],
    };
  });
  list.sort((a, b) => a.logicalBits - b.logicalBits);
  return Response.json(list);
}
