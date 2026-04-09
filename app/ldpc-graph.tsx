"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";

interface Graph {
  checkNodes: string[];
  dataNodes: string[];
  edges: [string, string][];
}

interface NodePos {
  x: number;
  y: number;
}

function makeLdpcCode(
  ncheck: number,
  ndata: number,
  density: number
): Graph {
  const checkNodes = Array.from({ length: ncheck }, (_, i) => `check_${i}`);
  const dataNodes = Array.from({ length: ndata }, (_, i) => `data_${i}`);
  const edges: [string, string][] = [];

  const edgeCount = Math.max(1, Math.round(density * ncheck));

  for (let i = 0; i < ndata; i++) {
    // Fisher-Yates shuffle to pick `edgeCount` random check nodes
    const indices = Array.from({ length: ncheck }, (_, j) => j);
    for (let j = indices.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [indices[j], indices[k]] = [indices[k], indices[j]];
    }
    const selected = indices.slice(0, edgeCount);
    for (const idx of selected) {
      edges.push([`data_${i}`, `check_${idx}`]);
    }
  }

  return { checkNodes, dataNodes, edges };
}

function computeLayout(graph: Graph): Map<string, NodePos> {
  const allNodes = [...graph.checkNodes, ...graph.dataNodes];
  const n = allNodes.length;
  const nodeIndex = new Map<string, number>();
  allNodes.forEach((node, i) => nodeIndex.set(node, i));

  // Build adjacency list
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of graph.edges) {
    const ai = nodeIndex.get(a)!;
    const bi = nodeIndex.get(b)!;
    adj[ai].push(bi);
    adj[bi].push(ai);
  }

  // Compute shortest-path distances via BFS (all pairs)
  const dist: number[][] = Array.from({ length: n }, () =>
    new Array(n).fill(Infinity)
  );
  for (let s = 0; s < n; s++) {
    dist[s][s] = 0;
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      for (const v of adj[u]) {
        if (dist[s][v] === Infinity) {
          dist[s][v] = dist[s][u] + 1;
          queue.push(v);
        }
      }
    }
  }

  // For disconnected pairs, use a large finite distance
  const maxFinite = Math.max(
    1,
    ...dist.flatMap((row) => row.filter((d) => d < Infinity))
  );
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (dist[i][j] === Infinity) dist[i][j] = maxFinite + 1;

  // Kamada-Kawai: ideal distances d_ij and spring strengths k_ij
  // L = desired edge length, scale factor
  const L = 80;
  const dij: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => dist[i][j] * L)
  );
  const kij: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 0 : 1 / (dist[i][j] * dist[i][j])
    )
  );

  // Initialize positions on a circle
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    x[i] = Math.cos(angle) * 100;
    y[i] = Math.sin(angle) * 100;
  }

  // Iteratively move node with largest partial derivative (gradient)
  const maxIter = 200 * n;
  const epsilon = 1e-2;

  for (let iter = 0; iter < maxIter; iter++) {
    // Find node m with largest |delta_m|
    let maxDelta = -1;
    let m = -1;
    for (let i = 0; i < n; i++) {
      let dEdx = 0;
      let dEdy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = x[i] - x[j];
        const dy = y[i] - y[j];
        const eucl = Math.sqrt(dx * dx + dy * dy) || 1e-6;
        dEdx += kij[i][j] * (dx - (dij[i][j] * dx) / eucl);
        dEdy += kij[i][j] * (dy - (dij[i][j] * dy) / eucl);
      }
      const delta = Math.sqrt(dEdx * dEdx + dEdy * dEdy);
      if (delta > maxDelta) {
        maxDelta = delta;
        m = i;
      }
    }

    if (maxDelta < epsilon) break;

    // Newton-Raphson to minimize energy for node m
    for (let inner = 0; inner < 50; inner++) {
      let dEdx = 0;
      let dEdy = 0;
      let d2Edx2 = 0;
      let d2Edy2 = 0;
      let d2Edxdy = 0;

      for (let j = 0; j < n; j++) {
        if (j === m) continue;
        const dx = x[m] - x[j];
        const dy = y[m] - y[j];
        const eucl2 = dx * dx + dy * dy;
        const eucl = Math.sqrt(eucl2) || 1e-6;
        const eucl3 = eucl2 * eucl;
        const k = kij[m][j];
        const d = dij[m][j];

        dEdx += k * (dx - (d * dx) / eucl);
        dEdy += k * (dy - (d * dy) / eucl);
        d2Edx2 += k * (1 - (d * dy * dy) / eucl3);
        d2Edy2 += k * (1 - (d * dx * dx) / eucl3);
        d2Edxdy += k * ((d * dx * dy) / eucl3);
      }

      // Solve 2x2 system: H * [deltaX, deltaY]^T = -[dEdx, dEdy]^T
      const det = d2Edx2 * d2Edy2 - d2Edxdy * d2Edxdy;
      if (Math.abs(det) < 1e-12) break;

      const deltaX = -(d2Edy2 * dEdx - d2Edxdy * dEdy) / det;
      const deltaY = -(-d2Edxdy * dEdx + d2Edx2 * dEdy) / det;

      x[m] += deltaX;
      y[m] += deltaY;

      if (deltaX * deltaX + deltaY * deltaY < epsilon * epsilon) break;
    }
  }

  // Normalize to fit in viewBox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
  }
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const padding = 60;
  const width = 1200;
  const height = 900;

  const positions = new Map<string, NodePos>();
  for (let i = 0; i < n; i++) {
    positions.set(allNodes[i], {
      x: padding + ((x[i] - minX) / rangeX) * (width - 2 * padding),
      y: padding + ((y[i] - minY) / rangeY) * (height - 2 * padding),
    });
  }

  return positions;
}

const CHECK_COLOR = "#670EFF";
const CHECK_TOGGLED = "#FF5900";
const DATA_COLOR = "gray";
const DATA_TOGGLED = "black";

export default function LdpcGraph() {
  const [ncheck, setNcheck] = useState(20);
  const [ndata, setNdata] = useState(20);
  const [density, setDensity] = useState(0.15);
  const [prob0, setProb0] = useState(0.9);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [positions, setPositions] = useState<Map<string, NodePos>>(new Map());
  const [nodeColors, setNodeColors] = useState<Map<string, string>>(new Map());

  const adjacency = useMemo(() => {
    if (!graph) return new Map<string, string[]>();
    const adj = new Map<string, string[]>();
    for (const node of [...graph.checkNodes, ...graph.dataNodes]) adj.set(node, []);
    for (const [a, b] of graph.edges) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    return adj;
  }, [graph]);

  const generate = useCallback(() => {
    const g = makeLdpcCode(ncheck, ndata, density);
    const pos = computeLayout(g);

    // Build adjacency for parity computation
    const adj = new Map<string, string[]>();
    for (const node of [...g.checkNodes, ...g.dataNodes]) adj.set(node, []);
    for (const [a, b] of g.edges) {
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }

    // Each data node gets a random hidden state (0 or 1), displayed as black on screen
    const dataState = new Map<string, number>();
    for (const node of g.dataNodes) {
      dataState.set(node, Math.random() < prob0 ? 0 : 1);
    }

    const colors = new Map<string, string>();
    // Data nodes all start as black (DATA_TOGGLED) on screen
    for (const node of g.dataNodes) colors.set(node, DATA_TOGGLED);
    // Check nodes get color based on parity of neighboring data node hidden states
    for (const node of g.checkNodes) {
      const parity = (adj.get(node) || []).reduce(
        (sum, neighbor) => sum + (dataState.get(neighbor) || 0),
        0
      ) % 2;
      colors.set(node, parity === 0 ? CHECK_COLOR : CHECK_TOGGLED);
    }

    setGraph(g);
    setPositions(pos);
    setNodeColors(colors);
  }, [ncheck, ndata, density, prob0]);

  const handleNodeClick = useCallback(
    (node: string) => {
      if (!node.startsWith("data_")) return;
      setNodeColors((prev) => {
        const next = new Map(prev);
        // Toggle data node
        const currentData = next.get(node);
        next.set(node, currentData === DATA_TOGGLED ? DATA_COLOR : DATA_TOGGLED);
        // Toggle connected check nodes
        for (const neighbor of adjacency.get(node) || []) {
          const currentCheck = next.get(neighbor);
          if (currentCheck === CHECK_COLOR) next.set(neighbor, CHECK_TOGGLED);
          else if (currentCheck === CHECK_TOGGLED) next.set(neighbor, CHECK_COLOR);
        }
        return next;
      });
    },
    [adjacency]
  );

  const svgContainerRef = useRef<HTMLDivElement>(null);
  const [svgHeight, setSvgHeight] = useState(0);

  useEffect(() => {
    function measure() {
      if (svgContainerRef.current) {
        const top = svgContainerRef.current.getBoundingClientRect().top;
        setSvgHeight(window.innerHeight - top - 8);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [graph]);

  return (
    <div className="flex w-full flex-1 flex-col items-center gap-4 overflow-hidden">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Check nodes
          <input
            type="number"
            min={1}
            max={50}
            value={ncheck}
            onChange={(e) => setNcheck(Number(e.target.value))}
            className="w-24 rounded border border-zinc-300 px-2 py-1 text-center dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Data nodes
          <input
            type="number"
            min={1}
            max={50}
            value={ndata}
            onChange={(e) => setNdata(Number(e.target.value))}
            className="w-24 rounded border border-zinc-300 px-2 py-1 text-center dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Density
          <input
            type="number"
            min={0.05}
            max={1}
            step={0.05}
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
            className="w-24 rounded border border-zinc-300 px-2 py-1 text-center dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          P(0)
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={prob0}
            onChange={(e) => setProb0(Number(e.target.value))}
            className="w-24 rounded border border-zinc-300 px-2 py-1 text-center dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <button
          onClick={generate}
          className="rounded bg-[#670EFF] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#5500dd]"
        >
          Generate
        </button>
      </div>

      {graph && (
        <>
          <div className="flex gap-6 text-xs text-zinc-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-[#670EFF]" /> Check node
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-gray-400" /> Data node
            </span>
            <span className="text-zinc-400">Click a data node to toggle parity</span>
          </div>
          <div ref={svgContainerRef} className="w-full" style={{ height: svgHeight > 0 ? svgHeight : undefined }}>
            <svg viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid meet" className="h-full w-full rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
              {graph.edges.map(([a, b], i) => {
                const pa = positions.get(a);
                const pb = positions.get(b);
                if (!pa || !pb) return null;
                const aOrange = nodeColors.get(a) === CHECK_TOGGLED;
                const bOrange = nodeColors.get(b) === CHECK_TOGGLED;
                const highlighted = aOrange || bOrange;
                return (
                  <line
                    key={i}
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke={highlighted ? CHECK_TOGGLED : "#d4d4d8"}
                    strokeWidth={highlighted ? 3 : 1.5}
                  />
                );
              })}
              {[...graph.checkNodes, ...graph.dataNodes].map((node) => {
                const pos = positions.get(node);
                if (!pos) return null;
                const isData = node.startsWith("data_");
                const radius = isData ? 10 : 12;
                return (
                  <circle
                    key={node}
                    cx={pos.x}
                    cy={pos.y}
                    r={radius}
                    fill={nodeColors.get(node) || (isData ? DATA_COLOR : CHECK_COLOR)}
                    stroke="white"
                    strokeWidth={2}
                    className={isData ? "cursor-pointer" : ""}
                    onClick={() => handleNodeClick(node)}
                  >
                    <title>{node}</title>
                  </circle>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
