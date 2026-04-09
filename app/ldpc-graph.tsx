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

interface HistoryEntry {
  ncheck: number;
  ndata: number;
  density: number;
  prob0: number;
  score: number;
  graphSeed: number;
  dataSeed: number;
  flips?: string;
}

// Mulberry32 seeded PRNG
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

function makeLdpcCode(
  ncheck: number,
  ndata: number,
  density: number,
  seed: number
): Graph {
  const rand = mulberry32(seed);
  const checkNodes = Array.from({ length: ncheck }, (_, i) => `check_${i}`);
  const dataNodes = Array.from({ length: ndata }, (_, i) => `data_${i}`);
  const edges: [string, string][] = [];

  const edgeCount = Math.max(1, Math.round(density * ncheck));

  for (let i = 0; i < ndata; i++) {
    const indices = Array.from({ length: ncheck }, (_, j) => j);
    for (let j = indices.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1));
      [indices[j], indices[k]] = [indices[k], indices[j]];
    }
    const selected = indices.slice(0, edgeCount);
    for (const idx of selected) {
      edges.push([`data_${i}`, `check_${idx}`]);
    }
  }

  return { checkNodes, dataNodes, edges };
}

function buildAdj(g: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of [...g.checkNodes, ...g.dataNodes]) adj.set(node, []);
  for (const [a, b] of g.edges) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  return adj;
}

function computeColors(
  g: Graph,
  adj: Map<string, string[]>,
  prob0: number,
  dataSeed: number
): Map<string, string> {
  const rand = mulberry32(dataSeed);
  const dataState = new Map<string, number>();
  for (const node of g.dataNodes) {
    dataState.set(node, rand() < prob0 ? 0 : 1);
  }

  const colors = new Map<string, string>();
  for (const node of g.dataNodes) colors.set(node, DATA_TOGGLED);
  for (const node of g.checkNodes) {
    const parity =
      (adj.get(node) || []).reduce(
        (sum, neighbor) => sum + (dataState.get(neighbor) || 0),
        0
      ) % 2;
    colors.set(node, parity === 0 ? CHECK_COLOR : CHECK_TOGGLED);
  }
  return colors;
}

// Encode which data nodes the player flipped as a hex bitmask
function encodeFlips(nodeColors: Map<string, string>, ndata: number): string {
  let bits = BigInt(0);
  for (let i = 0; i < ndata; i++) {
    if (nodeColors.get(`data_${i}`) === DATA_COLOR) {
      bits |= BigInt(1) << BigInt(i);
    }
  }
  return bits.toString(16);
}

// Apply encoded flips to an initial color state
function applyFlips(
  colors: Map<string, string>,
  adj: Map<string, string[]>,
  flipsHex: string
): Map<string, string> {
  const bits = BigInt("0x" + flipsHex);
  const next = new Map(colors);
  for (let i = 0; i < 64; i++) {
    if ((bits >> BigInt(i)) & BigInt(1)) {
      const node = `data_${i}`;
      if (!next.has(node)) continue;
      // Flip data node
      const cur = next.get(node);
      next.set(node, cur === DATA_TOGGLED ? DATA_COLOR : DATA_TOGGLED);
      // Flip adjacent check nodes
      for (const neighbor of adj.get(node) || []) {
        const cc = next.get(neighbor);
        if (cc === CHECK_COLOR) next.set(neighbor, CHECK_TOGGLED);
        else if (cc === CHECK_TOGGLED) next.set(neighbor, CHECK_COLOR);
      }
    }
  }
  return next;
}

function computeLayout(graph: Graph): Map<string, NodePos> {
  const allNodes = [...graph.checkNodes, ...graph.dataNodes];
  const n = allNodes.length;
  const nodeIndex = new Map<string, number>();
  allNodes.forEach((node, i) => nodeIndex.set(node, i));

  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b] of graph.edges) {
    const ai = nodeIndex.get(a)!;
    const bi = nodeIndex.get(b)!;
    adj[ai].push(bi);
    adj[bi].push(ai);
  }

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

  const maxFinite = Math.max(
    1,
    ...dist.flatMap((row) => row.filter((d) => d < Infinity))
  );
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (dist[i][j] === Infinity) dist[i][j] = maxFinite + 1;

  const L = 80;
  const dij: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => dist[i][j] * L)
  );
  const kij: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      i === j ? 0 : 1 / (dist[i][j] * dist[i][j])
    )
  );

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    x[i] = Math.cos(angle) * 100;
    y[i] = Math.sin(angle) * 100;
  }

  const maxIter = 200 * n;
  const epsilon = 1e-2;

  for (let iter = 0; iter < maxIter; iter++) {
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

      const det = d2Edx2 * d2Edy2 - d2Edxdy * d2Edxdy;
      if (Math.abs(det) < 1e-12) break;

      const deltaX = -(d2Edy2 * dEdx - d2Edxdy * dEdy) / det;
      const deltaY = -(-d2Edxdy * dEdx + d2Edx2 * dEdy) / det;

      x[m] += deltaX;
      y[m] += deltaY;

      if (deltaX * deltaX + deltaY * deltaY < epsilon * epsilon) break;
    }
  }

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
  const width = 1000;
  const height = 1000;

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
const CHECK_TOGGLED = "#f97316";
const DATA_COLOR = "#475569";
const DATA_TOGGLED = "#e2e8f0";

function makeShareUrl(entry: HistoryEntry): string {
  const obj: Record<string, string> = {
    c: String(entry.ncheck),
    d: String(entry.ndata),
    k: String(entry.density),
    p: String(entry.prob0),
    gs: String(entry.graphSeed),
    ds: String(entry.dataSeed),
  };
  if (entry.flips) {
    obj.f = entry.flips;
    obj.sc = String(entry.score);
  }
  const params = new URLSearchParams(obj);
  return `${window.location.origin}${window.location.pathname}?${params}`;
}

export default function LdpcGraph() {
  const [ncheck, setNcheck] = useState(20);
  const [ndata, setNdata] = useState(20);
  const [density, setDensity] = useState(0.15);
  const [prob0, setProb0] = useState(0.9);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [positions, setPositions] = useState<Map<string, NodePos>>(new Map());
  const [nodeColors, setNodeColors] = useState<Map<string, string>>(new Map());
  const [graphSeed, setGraphSeed] = useState(0);
  const [dataSeed, setDataSeed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [frozen, setFrozen] = useState(false);
  // Challenge info from a shared link
  const [challenge, setChallenge] = useState<{ score: number; flips: string } | null>(null);
  const [showingChallenger, setShowingChallenger] = useState(false);

  const adjacency = useMemo(() => {
    if (!graph) return new Map<string, string[]>();
    return buildAdj(graph);
  }, [graph]);

  // The initial colors for the current instance (before player moves)
  const [initialColors, setInitialColors] = useState<Map<string, string>>(new Map());

  const loadInstance = useCallback(
    (c: number, d: number, k: number, p: number, gs: number, ds: number) => {
      const g = makeLdpcCode(c, d, k, gs);
      const pos = computeLayout(g);
      const adj = buildAdj(g);
      const colors = computeColors(g, adj, p, ds);
      setNcheck(c);
      setNdata(d);
      setDensity(k);
      setProb0(p);
      setGraphSeed(gs);
      setDataSeed(ds);
      setGraph(g);
      setPositions(pos);
      setNodeColors(colors);
      setInitialColors(colors);
      setFrozen(false);
      setShowingChallenger(false);
    },
    []
  );

  // On mount, check URL for shared instance
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    const d = params.get("d");
    const k = params.get("k");
    const p = params.get("p");
    const gs = params.get("gs");
    const ds = params.get("ds");
    if (c && d && k && p && gs && ds) {
      loadInstance(
        Number(c), Number(d), Number(k), Number(p), Number(gs), Number(ds)
      );
      const f = params.get("f");
      const sc = params.get("sc");
      if (f && sc) {
        setChallenge({ score: Number(sc), flips: f });
      } else {
        setChallenge(null);
      }
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadInstance]);

  const generateGraph = useCallback(() => {
    const gs = newSeed();
    const ds = newSeed();
    const g = makeLdpcCode(ncheck, ndata, density, gs);
    const pos = computeLayout(g);
    const adj = buildAdj(g);
    const colors = computeColors(g, adj, prob0, ds);
    setGraphSeed(gs);
    setDataSeed(ds);
    setGraph(g);
    setPositions(pos);
    setNodeColors(colors);
    setInitialColors(colors);
    setFrozen(false);
    setChallenge(null);
    setShowingChallenger(false);
  }, [ncheck, ndata, density, prob0]);

  const score = useMemo(() => {
    if (!graph) return 0;
    let count = 0;
    for (const node of graph.checkNodes) {
      if (nodeColors.get(node) === CHECK_TOGGLED) count++;
    }
    return count;
  }, [graph, nodeColors]);

  const handleRandomize = useCallback(() => {
    if (!graph) return;
    const ds = newSeed();
    const adj = buildAdj(graph);
    const colors = computeColors(graph, adj, prob0, ds);
    setDataSeed(ds);
    setNodeColors(colors);
    setInitialColors(colors);
    setFrozen(false);
    setChallenge(null);
    setShowingChallenger(false);
  }, [graph, prob0]);

  const handleSubmit = useCallback(() => {
    if (!graph || frozen) return;
    const flips = encodeFlips(nodeColors, graph.dataNodes.length);
    setFrozen(true);
    setHistory((prev) => [
      ...prev,
      { ncheck, ndata, density, prob0, score, graphSeed, dataSeed, flips },
    ]);
  }, [graph, frozen, nodeColors, ncheck, ndata, density, prob0, score, graphSeed, dataSeed]);

  const handleNodeClick = useCallback(
    (node: string) => {
      if (frozen || showingChallenger) return;
      if (!node.startsWith("data_")) return;
      setNodeColors((prev) => {
        const next = new Map(prev);
        const currentData = next.get(node);
        next.set(node, currentData === DATA_TOGGLED ? DATA_COLOR : DATA_TOGGLED);
        for (const neighbor of adjacency.get(node) || []) {
          const currentCheck = next.get(neighbor);
          if (currentCheck === CHECK_COLOR) next.set(neighbor, CHECK_TOGGLED);
          else if (currentCheck === CHECK_TOGGLED) next.set(neighbor, CHECK_COLOR);
        }
        return next;
      });
    },
    [adjacency, frozen, showingChallenger]
  );

  const toggleChallengerView = useCallback(() => {
    if (!challenge || !graph) return;
    if (showingChallenger) {
      // Restore player's current state
      setNodeColors(initialColors);
      setShowingChallenger(false);
    } else {
      // Show challenger's solution
      const solved = applyFlips(initialColors, adjacency, challenge.flips);
      setNodeColors(solved);
      setShowingChallenger(true);
    }
  }, [challenge, graph, showingChallenger, initialColors, adjacency]);

  const copyShareLink = useCallback(
    (entry: HistoryEntry, idx: number) => {
      const url = makeShareUrl(entry);
      navigator.clipboard.writeText(url).then(() => {
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
      });
    },
    []
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
    <div className="flex w-full flex-1 flex-col items-center gap-3 overflow-hidden">
      {/* Challenge banner */}
      {challenge && (
        <div className="flex items-center gap-4 rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-5 py-2 text-sm">
          <span className="font-semibold text-orange-600">
            Challenge: someone scored {challenge.score}
          </span>
          <span className="text-zinc-500">Can you beat it?</span>
          <button
            onClick={toggleChallengerView}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
          >
            {showingChallenger ? "Hide solution" : "Show solution"}
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-6">
        {/* Graph structure controls */}
        <div className="flex items-end gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-3 shadow-sm">
          <label className="flex flex-col gap-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Check
            <input
              type="number"
              min={1}
              max={50}
              value={ncheck}
              onChange={(e) => setNcheck(Number(e.target.value))}
              className="w-20 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-center text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Data
            <input
              type="number"
              min={1}
              max={50}
              value={ndata}
              onChange={(e) => setNdata(Number(e.target.value))}
              className="w-20 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-center text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            Density
            <input
              type="number"
              min={0.05}
              max={1}
              step={0.05}
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
              className="w-20 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-center text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <button
            onClick={generateGraph}
            className="rounded-lg bg-indigo-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition-all hover:bg-indigo-500 hover:shadow-indigo-500/30 active:scale-95"
          >
            New Graph
          </button>
        </div>

        {/* Data state controls */}
        <div className="flex items-end gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-5 py-3 shadow-sm">
          <label className="flex flex-col gap-1 text-xs font-medium tracking-wide text-zinc-500 uppercase">
            P(0)
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={prob0}
              onChange={(e) => setProb0(Number(e.target.value))}
              className="w-20 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-center text-sm text-zinc-800 outline-none transition-colors focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
            />
          </label>
          <button
            onClick={handleRandomize}
            disabled={!graph}
            className="rounded-lg bg-orange-600 px-5 py-1.5 text-sm font-semibold text-white shadow-md shadow-orange-500/20 transition-all hover:bg-orange-500 hover:shadow-orange-500/30 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Randomize
          </button>
        </div>

        {/* Submit */}
        {graph && (
          <button
            onClick={handleSubmit}
            disabled={frozen}
            className={`rounded-lg px-5 py-1.5 text-sm font-semibold shadow-md transition-all active:scale-95 ${
              frozen
                ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-none cursor-default"
                : "bg-emerald-600 text-white shadow-emerald-500/20 hover:bg-emerald-500 hover:shadow-emerald-500/30"
            }`}
          >
            {frozen ? "Submitted" : "Submit Score"}
          </button>
        )}
      </div>

      {/* Legend + Score */}
      {graph && (
        <div className="flex items-center gap-6 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#670EFF] shadow-[0_0_6px_#670EFF]" />
            <span className="text-zinc-400">Check</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#475569]" />
            <span className="text-zinc-400">Data</span>
          </span>
          <span className="text-zinc-600">
            {frozen
              ? "Score submitted — share the link!"
              : showingChallenger
                ? "Viewing challenger's solution"
                : "Click a data node to toggle parity"}
          </span>
          <span className="ml-auto flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1">
            <span className="text-zinc-500 uppercase tracking-wide">Score</span>
            <span className={`text-lg font-bold tabular-nums ${score === 0 ? "text-emerald-600" : "text-orange-500"}`}>
              {score}
            </span>
            <span className="text-zinc-600">/ {graph.checkNodes.length}</span>
          </span>
        </div>
      )}

      {/* Graph + History */}
      {graph && (
        <div ref={svgContainerRef} className="flex w-full gap-3" style={{ height: svgHeight > 0 ? svgHeight : undefined }}>
          <svg
            viewBox="0 0 1000 1000"
            preserveAspectRatio="xMidYMid meet"
            className={`h-full w-full rounded-xl border bg-white ${frozen ? "border-emerald-500/40" : "border-zinc-200"}`}
          >
            <defs>
              <filter id="glow-check" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-orange" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-data" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Edges */}
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
                  stroke={highlighted ? "#f97316" : "#d4d4d8"}
                  strokeWidth={highlighted ? 2.5 : 1}
                  opacity={highlighted ? 0.8 : 0.5}
                />
              );
            })}

            {/* Nodes */}
            {[...graph.checkNodes, ...graph.dataNodes].map((node) => {
              const pos = positions.get(node);
              if (!pos) return null;
              const isData = node.startsWith("data_");
              const color = nodeColors.get(node) || (isData ? DATA_COLOR : CHECK_COLOR);
              const isOrange = color === CHECK_TOGGLED;
              const radius = isData ? 9 : 11;

              let filter: string | undefined;
              if (isOrange) filter = "url(#glow-orange)";
              else if (!isData) filter = "url(#glow-check)";
              else if (color === DATA_TOGGLED) filter = "url(#glow-data)";

              const clickable = isData && !frozen && !showingChallenger;

              return (
                <circle
                  key={node}
                  cx={pos.x}
                  cy={pos.y}
                  r={radius}
                  fill={color}
                  stroke={isData ? "transparent" : "rgba(0,0,0,0.08)"}
                  strokeWidth={1.5}
                  filter={filter}
                  className={clickable ? "cursor-pointer" : ""}
                  style={{
                    transition: "fill 0.2s ease, filter 0.2s ease",
                    opacity: frozen ? 0.85 : 1,
                  }}
                  onClick={() => handleNodeClick(node)}
                >
                  <title>{node}</title>
                </circle>
              );
            })}
          </svg>

          {/* History */}
          <div className="flex w-72 shrink-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50">
            <div className="border-b border-zinc-200 px-4 py-2.5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">History</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {history.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-zinc-600">
                  Press Randomize to start
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">#</th>
                      <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">Hardness</th>
                      <th className="sticky top-0 bg-zinc-50 px-2 py-2 text-right font-medium">Score</th>
                      <th className="sticky top-0 bg-zinc-50 px-2 py-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry, i) => (
                      <tr
                        key={i}
                        className="border-t border-zinc-100 transition-colors hover:bg-zinc-100"
                      >
                        <td className="px-2 py-1.5 tabular-nums text-zinc-500">{i + 1}</td>
                        <td className="px-2 py-1.5">
                          <span className="text-zinc-500">
                            {entry.ncheck}c {entry.ndata}d {entry.density}k {(1 - entry.prob0).toFixed(2)}p
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <span
                            className={`font-bold tabular-nums ${
                              entry.score === 0
                                ? "text-emerald-600"
                                : entry.score <= 2
                                  ? "text-yellow-600"
                                  : "text-orange-500"
                            }`}
                          >
                            {entry.score}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            onClick={() => copyShareLink(entry, i)}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
                              copiedIdx === i
                                ? "bg-emerald-500/15 text-emerald-400"
                                : entry.flips
                                  ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                                  : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                            }`}
                          >
                            {copiedIdx === i ? (
                              "Copied!"
                            ) : (
                              <>
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                  <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                                  <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                                </svg>
                                {entry.flips ? "Challenge" : "Share"}
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
