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
    const { id, name } = JSON.parse(readFileSync(join(GRAPHS_DIR, filename), "utf-8"));
    return { id, name };
  });
  return Response.json(list);
}
