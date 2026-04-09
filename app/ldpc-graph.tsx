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

function getGraphDifficulty(entry: { ncheck: number; ndata: number }): { label: string; color: string } {
  if (entry.ncheck <= 10 && entry.ndata <= 10) return { label: "Easy", color: "text-emerald-600" };
  if (entry.ncheck <= 20 && entry.ndata <= 20) return { label: "Medium", color: "text-amber-500" };
  return { label: "Hard", color: "text-red-600" };
}

function getFlipDifficulty(prob0: number): { label: string; color: string } {
  if (prob0 >= 0.97) return { label: "Easy", color: "text-emerald-600" };
  if (prob0 >= 0.95) return { label: "Medium", color: "text-amber-500" };
  return { label: "Hard", color: "text-red-600" };
}

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
  const [sharePopover, setSharePopover] = useState<number | null>(null);
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

  const generateGraph = useCallback((c: number, d: number, k: number, p: number) => {
    const gs = newSeed();
    const ds = newSeed();
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
    setChallenge(null);
    setShowingChallenger(false);
  }, []);

  const score = useMemo(() => {
    if (!graph) return 0;
    let count = 0;
    for (const node of graph.checkNodes) {
      if (nodeColors.get(node) === CHECK_TOGGLED) count++;
    }
    return count;
  }, [graph, nodeColors]);

  const handleRandomize = useCallback((p: number) => {
    if (!graph) return;
    const ds = newSeed();
    const adj = buildAdj(graph);
    const colors = computeColors(graph, adj, p, ds);
    setProb0(p);
    setDataSeed(ds);
    setNodeColors(colors);
    setInitialColors(colors);
    setFrozen(false);
    setChallenge(null);
    setShowingChallenger(false);
  }, [graph]);

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

  // Close share popover on outside click
  const sharePopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sharePopover === null) return;
    function handleClick(e: MouseEvent) {
      if (sharePopoverRef.current && !sharePopoverRef.current.contains(e.target as Node)) {
        setSharePopover(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sharePopover]);

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
      <div className="flex flex-wrap items-center gap-4">
        {/* Difficulty buttons */}
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 shadow-sm">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-400">New Game</span>
          <button
            onClick={() => generateGraph(10, 10, 0.3, 0.9)}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 active:scale-95"
          >
            Easy
          </button>
          <button
            onClick={() => generateGraph(20, 20, 0.15, 0.9)}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 active:scale-95"
          >
            Medium
          </button>
          <button
            onClick={() => generateGraph(40, 40, 0.08, 0.94)}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-500 active:scale-95"
          >
            Hard
          </button>
        </div>

        {/* Randomize */}
        <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 shadow-sm">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-400">Randomize</span>
          <button
            onClick={() => handleRandomize(0.97)}
            disabled={!graph}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Easy
          </button>
          <button
            onClick={() => handleRandomize(0.95)}
            disabled={!graph}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-amber-400 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Medium
          </button>
          <button
            onClick={() => handleRandomize(0.9)}
            disabled={!graph}
            className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-red-500 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
          >
            Hard
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
            className="h-full w-full bg-white"
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
                  stroke={highlighted ? "#f97316" : "#374151"}
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
              const radius = isData ? 14 : 11;

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
                      <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">Graph</th>
                      <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">Flips</th>
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
                          <span className={`font-semibold ${getGraphDifficulty(entry).color}`}>
                            {getGraphDifficulty(entry).label}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`font-semibold ${getFlipDifficulty(entry.prob0).color}`}>
                            {getFlipDifficulty(entry.prob0).label}
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
                            onClick={() => setSharePopover(sharePopover === i ? null : i)}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
                              entry.flips
                                ? "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
                                : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700"
                            }`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                              <path d="M13 4.5a2.5 2.5 0 1 1 .702 1.737L6.97 9.604a2.5 2.5 0 0 1 0 .792l6.733 3.367a2.5 2.5 0 1 1-.671 1.341l-6.733-3.367a2.5 2.5 0 1 1 0-3.474l6.733-3.367A2.5 2.5 0 0 1 13 4.5Z" />
                            </svg>
                            {entry.flips ? "Challenge" : "Share"}
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
      {/* Share modal */}
      {sharePopover !== null && history[sharePopover] && (() => {
        const entry = history[sharePopover];
        const idx = sharePopover;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/30" onClick={() => setSharePopover(null)} />
            <div ref={sharePopoverRef} className="relative w-80 rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl">
              <button
                onClick={() => setSharePopover(null)}
                className="absolute right-3 top-3 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
              <h3 className="mb-1 text-lg font-bold text-zinc-800">
                {entry.flips ? "Challenge a friend" : "Share this puzzle"}
              </h3>
              <p className="mb-4 text-sm text-zinc-500">
                {entry.flips
                  ? `You scored ${entry.score} — dare someone to beat it!`
                  : "Send this puzzle to a friend"}
              </p>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => { copyShareLink(entry, idx); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-zinc-400">
                    <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                    <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                  </svg>
                  {copiedIdx === idx ? <span className="font-medium text-emerald-600">Copied!</span> : "Copy link"}
                </button>
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("I scored " + entry.score + " on this LDPC puzzle! Can you beat me?")}&url=${encodeURIComponent(makeShareUrl(entry))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-800" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  X / Twitter
                </a>
                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(makeShareUrl(entry))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#1877F2]" fill="currentColor">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                  </svg>
                  Facebook
                </a>
                <a
                  href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(makeShareUrl(entry))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#0A66C2]" fill="currentColor">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                  </svg>
                  LinkedIn
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent("LDPC Puzzle Challenge!")}&body=${encodeURIComponent("I scored " + entry.score + " on this LDPC puzzle! Can you beat me?\n\n" + makeShareUrl(entry))}`}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-zinc-400">
                    <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
                    <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
                  </svg>
                  Email
                </a>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
