"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";

interface Graph {
  checkNodes: string[];
  dataNodes: string[];
  edges: [string, string][];
}

interface GraphMeta {
  id: string;
  name: string;
  logicalBits: number;
  checkNodes: string[];
  dataNodes: string[];
  edges: [string, string][];
  positions: Record<string, { x: number; y: number }>;
  xCheckNodes?: string[];
  zCheckNodes?: string[];
}

interface GraphData {
  id: string;
  name: string;
  maxErrors: number;
  checkNodes: string[];
  dataNodes: string[];
  edges: [string, string][];
  positions: Record<string, { x: number; y: number }>;
  H: number[][];
  G: number[][];
  xCheckNodes?: string[];
  zCheckNodes?: string[];
  Hx?: number[][];
  Hz?: number[][];
  Lx?: number[];
  Lz?: number[];
}

interface HistoryEntry {
  graphId: string;
  graphName: string;
  numErrors: number;
  logicalError: boolean;
  bitsFlipped: number;
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

function buildAdj(g: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const node of [...g.checkNodes, ...g.dataNodes]) adj.set(node, []);
  for (const [a, b] of g.edges) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  return adj;
}

function pickErrorSet(g: Graph, numErrors: number, dataSeed: number): Set<number> {
  const rand = mulberry32(dataSeed);
  const n = g.dataNodes.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < numErrors; i++) {
    const j = i + Math.floor(rand() * (n - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return new Set(indices.slice(0, numErrors));
}

function computeColors(
  g: Graph,
  adj: Map<string, string[]>,
  numErrors: number,
  dataSeed: number
): Map<string, string> {
  const errorSet = pickErrorSet(g, numErrors, dataSeed);
  const dataState = new Map<string, number>();
  for (let i = 0; i < g.dataNodes.length; i++) {
    dataState.set(g.dataNodes[i], errorSet.has(i) ? 1 : 0);
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
function encodeFlips(nodeColors: Map<string, string>, dataNodes: string[], isQuantum = false): string {
  if (isQuantum) return "";
  let bits = BigInt(0);
  for (let i = 0; i < dataNodes.length; i++) {
    if (nodeColors.get(dataNodes[i]) === DATA_COLOR) {
      bits |= BigInt(1) << BigInt(i);
    }
  }
  return bits.toString(16);
}

function computeQuantumColors(
  g: Graph,
  adj: Map<string, string[]>,
  numErrors: number,
  dataSeed: number,
  xCheckSet: Set<string>,
  zCheckSet: Set<string>
): { colors: Map<string, string>; xErrorNodes: Set<string>; zErrorNodes: Set<string> } {
  const zSeed = (dataSeed ^ 0xdeadbeef) >>> 0;
  const xErrIndices = pickErrorSet(g, numErrors, dataSeed);
  const zErrIndices = pickErrorSet(g, numErrors, zSeed);

  const colors = new Map<string, string>();
  const xErrorNodes = new Set<string>();
  const zErrorNodes = new Set<string>();

  // Data nodes start hidden (errors revealed only through syndrome, not color)
  for (let i = 0; i < g.dataNodes.length; i++) {
    const node = g.dataNodes[i];
    colors.set(node, DATA_TOGGLED);
    if (xErrIndices.has(i)) xErrorNodes.add(node);
    if (zErrIndices.has(i)) zErrorNodes.add(node);
  }

  // X-checks detect Z errors: triggered when parity of adjacent Z-error qubits is odd
  for (const node of xCheckSet) {
    const parity = (adj.get(node) || []).reduce(
      (sum, nb) => sum + (zErrorNodes.has(nb) ? 1 : 0), 0
    ) % 2;
    colors.set(node, parity === 0 ? X_CHECK_COLOR : X_CHECK_TRIGGERED);
  }
  // Z-checks detect X errors: triggered when parity of adjacent X-error qubits is odd
  for (const node of zCheckSet) {
    const parity = (adj.get(node) || []).reduce(
      (sum, nb) => sum + (xErrorNodes.has(nb) ? 1 : 0), 0
    ) % 2;
    colors.set(node, parity === 0 ? Z_CHECK_COLOR : Z_CHECK_TRIGGERED);
  }

  return { colors, xErrorNodes, zErrorNodes };
}

function evalQuantumLogicalError(
  g: Graph,
  adj: Map<string, string[]>,
  xCheckSet: Set<string>,
  zCheckSet: Set<string>,
  matLx: number[],
  matLz: number[],
  numErrors: number,
  dataSeed: number,
  xErrors: Set<string>,
  zErrors: Set<string>
): { isLogicalError: boolean; bitsFlipped: number } {
  const zSeed = (dataSeed ^ 0xdeadbeef) >>> 0;
  const hiddenXIndices = pickErrorSet(g, numErrors, dataSeed);
  const hiddenZIndices = pickErrorSet(g, numErrors, zSeed);

  const hiddenX = g.dataNodes.map((_, i) => (hiddenXIndices.has(i) ? 1 : 0));
  const hiddenZ = g.dataNodes.map((_, i) => (hiddenZIndices.has(i) ? 1 : 0));
  const userX   = g.dataNodes.map((n) => (xErrors.has(n) ? 1 : 0));
  const userZ   = g.dataNodes.map((n) => (zErrors.has(n) ? 1 : 0));

  const residualX = hiddenX.map((e, i) => e ^ userX[i]);
  const residualZ = hiddenZ.map((e, i) => e ^ userZ[i]);

  // Build lookup maps for residual errors by node name
  const resXByNode = new Map(g.dataNodes.map((n, i) => [n, residualX[i]]));
  const resZByNode = new Map(g.dataNodes.map((n, i) => [n, residualZ[i]]));

  // All Z-checks must have even parity over residualX (Z-checks detect X errors)
  let syndromeOk = true;
  for (const node of zCheckSet) {
    const parity = (adj.get(node) || []).reduce((s, nb) => s + (resXByNode.get(nb) || 0), 0) % 2;
    if (parity !== 0) { syndromeOk = false; break; }
  }
  // All X-checks must have even parity over residualZ (X-checks detect Z errors)
  if (syndromeOk) {
    for (const node of xCheckSet) {
      const parity = (adj.get(node) || []).reduce((s, nb) => s + (resZByNode.get(nb) || 0), 0) % 2;
      if (parity !== 0) { syndromeOk = false; break; }
    }
  }

  // Logical X error: Lz · residualX ≠ 0  (Lz detects X-type logical errors)
  const logicalXErr = matLz.reduce((xor, bit, i) => xor ^ (bit & residualX[i]), 0) !== 0;
  // Logical Z error: Lx · residualZ ≠ 0  (Lx detects Z-type logical errors)
  const logicalZErr = matLx.reduce((xor, bit, i) => xor ^ (bit & residualZ[i]), 0) !== 0;

  const bitsFlipped =
    residualX.reduce((s, b) => s + b, 0) + residualZ.reduce((s, b) => s + b, 0);
  return { isLogicalError: !syndromeOk || logicalXErr || logicalZErr, bitsFlipped };
}

// Apply encoded flips to an initial color state
function applyFlips(
  colors: Map<string, string>,
  adj: Map<string, string[]>,
  dataNodes: string[],
  flipsHex: string
): Map<string, string> {
  const bits = BigInt("0x" + flipsHex);
  const next = new Map(colors);
  for (let i = 0; (bits >> BigInt(i)) > BigInt(0); i++) {
    if ((bits >> BigInt(i)) & BigInt(1)) {
      const node = dataNodes[i];
      if (!node || !next.has(node)) continue;
      const cur = next.get(node);
      next.set(node, cur === DATA_TOGGLED ? DATA_COLOR : DATA_TOGGLED);
      for (const neighbor of adj.get(node) || []) {
        const cc = next.get(neighbor);
        if (cc === CHECK_COLOR) next.set(neighbor, CHECK_TOGGLED);
        else if (cc === CHECK_TOGGLED) next.set(neighbor, CHECK_COLOR);
      }
    }
  }
  return next;
}

function makeShareUrl(entry: HistoryEntry): string {
  const obj: Record<string, string> = {
    g: entry.graphId,
    ne: String(entry.numErrors),
    ds: String(entry.dataSeed),
  };
  if (entry.flips) {
    obj.f = entry.flips;
    obj.le = entry.logicalError ? "1" : "0";
  }
  const params = new URLSearchParams(obj);
  return `${window.location.origin}${window.location.pathname}?${params}`;
}

const CHECK_COLOR = "#670EFF";
const CHECK_TOGGLED = "#f97316";
const DATA_COLOR = "#475569";
const DATA_TOGGLED = "#e2e8f0";

// Quantum-specific colors
const X_CHECK_COLOR     = "#93c5fd";  // light blue  – X-check satisfied (detects Z errors)
const X_CHECK_TRIGGERED = "#1e40af";  // deep blue   – X-check triggered
const Z_CHECK_COLOR     = "#fca5a5";  // light red   – Z-check satisfied (detects X errors)
const Z_CHECK_TRIGGERED = "#991b1b";  // deep red    – Z-check triggered
const DATA_X_ERROR      = "#ef4444";  // red         – X error (bit flip)
const DATA_Z_ERROR      = "#3b82f6";  // blue        – Z error (phase flip)
const DATA_BOTH_ERROR   = "#22c55e";  // green       – both X and Z error

export default function LdpcGraph() {
  const [graphList, setGraphList] = useState<GraphMeta[]>([]);
  const [selectedGraphId, setSelectedGraphId] = useState<string>("");
  const [selectedGraphName, setSelectedGraphName] = useState<string>("");
  const [maxErrors, setMaxErrors] = useState(1);
  const [numErrors, setNumErrors] = useState(1);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [matG, setMatG] = useState<number[][]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [nodeColors, setNodeColors] = useState<Map<string, string>>(new Map());
  const [dataSeed, setDataSeed] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [sharePopover, setSharePopover] = useState<number | null>(null);
  const [assessmentMode, setAssessmentMode] = useState(false);
  const [assessmentSuccess, setAssessmentSuccess] = useState(false);
  const [assessmentMessage, setAssessmentMessage] = useState<string>("");
  const [hiddenErrorNodes, setHiddenErrorNodes] = useState<Set<string>>(new Set());
  const [challenge, setChallenge] = useState<{ logicalError: boolean; flips: string } | null>(null);
  const [showingChallenger, setShowingChallenger] = useState(false);
  const [initialColors, setInitialColors] = useState<Map<string, string>>(new Map());
  const lastChallengeTimeRef = useRef<number>(0);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const numErrorsRef = useRef<number>(1);
  const assessmentModeRef = useRef<boolean>(false);

  // Quantum-specific state
  const [isQuantum, setIsQuantum] = useState(false);
  const [quantumXSet, setQuantumXSet] = useState<Set<string>>(new Set());
  const [quantumZSet, setQuantumZSet] = useState<Set<string>>(new Set());
  const [matLx, setMatLx] = useState<number[]>([]);
  const [matLz, setMatLz] = useState<number[]>([]);
  const [hiddenQXErrors, setHiddenQXErrors] = useState<Set<string>>(new Set()); // secret X errors
  const [hiddenQZErrors, setHiddenQZErrors] = useState<Set<string>>(new Set()); // secret Z errors
  const [quantumXErrors, setQuantumXErrors] = useState<Set<string>>(new Set()); // user's X corrections
  const [quantumZErrors, setQuantumZErrors] = useState<Set<string>>(new Set()); // user's Z corrections
  const [hiddenZErrors, setHiddenZErrors] = useState<Set<string>>(new Set());
  const isQuantumRef = useRef<boolean>(false);

  const adjacency = useMemo(() => {
    if (!graph) return new Map<string, string[]>();
    return buildAdj(graph);
  }, [graph]);

  // Keep isQuantumRef in sync for stable callbacks
  useEffect(() => { isQuantumRef.current = isQuantum; }, [isQuantum]);

  // Derived color map for quantum codes (replaces nodeColors during rendering)
  const quantumColors = useMemo((): Map<string, string> | null => {
    if (!isQuantum || !graph) return null;
    const colors = new Map<string, string>();

    // Data nodes: show only the user's corrections (hidden errors are invisible)
    for (const node of graph.dataNodes) {
      const hasX = quantumXErrors.has(node);
      const hasZ = quantumZErrors.has(node);
      if (hasX && hasZ) colors.set(node, DATA_BOTH_ERROR);
      else if (hasX) colors.set(node, DATA_X_ERROR);
      else if (hasZ) colors.set(node, DATA_Z_ERROR);
      else colors.set(node, DATA_TOGGLED);
    }

    // X-checks detect Z errors: syndrome = parity of (hiddenZ XOR userZ) among neighbors
    for (const node of quantumXSet) {
      const parity = (adjacency.get(node) || []).reduce(
        (sum, nb) => {
          const netZ = hiddenQZErrors.has(nb) !== quantumZErrors.has(nb);
          return sum + (netZ ? 1 : 0);
        }, 0) % 2;
      colors.set(node, parity === 0 ? X_CHECK_COLOR : X_CHECK_TRIGGERED);
    }

    // Z-checks detect X errors: syndrome = parity of (hiddenX XOR userX) among neighbors
    for (const node of quantumZSet) {
      const parity = (adjacency.get(node) || []).reduce(
        (sum, nb) => {
          const netX = hiddenQXErrors.has(nb) !== quantumXErrors.has(nb);
          return sum + (netX ? 1 : 0);
        }, 0) % 2;
      colors.set(node, parity === 0 ? Z_CHECK_COLOR : Z_CHECK_TRIGGERED);
    }

    return colors;
  }, [isQuantum, graph, hiddenQXErrors, hiddenQZErrors, quantumXErrors, quantumZErrors, quantumXSet, quantumZSet, adjacency]);

  const loadGraphById = useCallback(
    async (graphId: string, ne: number, ds: number) => {
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      const res = await fetch(`/api/graphs/${graphId}`);
      if (!res.ok) return;
      const gd: GraphData = await res.json();
      const g: Graph = {
        checkNodes: gd.checkNodes,
        dataNodes: gd.dataNodes,
        edges: gd.edges,
      };
      const clampedNe = Math.min(Math.max(ne, 1), gd.maxErrors);
      const adj = buildAdj(g);
      const isQ = !!(gd.xCheckNodes?.length);
      isQuantumRef.current = isQ;

      let colors: Map<string, string>;
      let initQXErrors = new Set<string>();
      let initQZErrors = new Set<string>();
      if (isQ) {
        const xSet = new Set(gd.xCheckNodes!);
        const zSet = new Set(gd.zCheckNodes!);
        const result = computeQuantumColors(g, adj, clampedNe, ds, xSet, zSet);
        colors = result.colors;
        initQXErrors = result.xErrorNodes;
        initQZErrors = result.zErrorNodes;
        setQuantumXSet(xSet);
        setQuantumZSet(zSet);
        setMatLx(gd.Lx || []);
        setMatLz(gd.Lz || []);
        setHiddenQXErrors(initQXErrors);
        setHiddenQZErrors(initQZErrors);
        setQuantumXErrors(new Set());
        setQuantumZErrors(new Set());
        setHiddenZErrors(new Set());
      } else {
        colors = computeColors(g, adj, clampedNe, ds);
        setQuantumXSet(new Set());
        setQuantumZSet(new Set());
        setMatLx([]);
        setMatLz([]);
        setQuantumXErrors(new Set());
        setQuantumZErrors(new Set());
        setHiddenZErrors(new Set());
      }

      setIsQuantum(isQ);
      setSelectedGraphId(graphId);
      setSelectedGraphName(gd.name);
      setMaxErrors(gd.maxErrors);
      setNumErrors(clampedNe);
      setGraph(g);
      setMatG(gd.G);
      setPositions(gd.positions);
      setDataSeed(ds);
      setNodeColors(colors);
      setInitialColors(colors);
      assessmentModeRef.current = false;
      setAssessmentMode(false);
      setHiddenErrorNodes(new Set());
      setShowingChallenger(false);
      setChallenge(null);
      lastChallengeTimeRef.current = Date.now();
    },
    []
  );

  // Fetch graph list on mount
  useEffect(() => {
    fetch("/api/graphs")
      .then((r) => r.json())
      .then(setGraphList)
      .catch(console.error);
  }, []);

  // On mount, check URL for shared instance
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get("g");
    const ne = params.get("ne");
    const ds = params.get("ds");
    if (g && ne && ds) {
      loadGraphById(g, Number(ne), Number(ds)).then(() => {
        window.history.replaceState({}, "", window.location.pathname);
        const f = params.get("f");
        const le = params.get("le");
        if (f && le !== null) {
          setChallenge({ logicalError: le === "1", flips: f });
        } else {
          setChallenge(null);
        }
      });
    }
  }, [loadGraphById]);

  const logicalErrors = useMemo(
    () => history.filter((e) => e.logicalError).length,
    [history]
  );

  function evalLogicalError(
    g: Graph,
    gMat: number[][],
    ne: number,
    seed: number,
    colors: Map<string, string>
  ): { isLogicalError: boolean; bitsFlipped: number } {
    const errorSet = pickErrorSet(g, ne, seed);
    const hidden = g.dataNodes.map((_, i) => (errorSet.has(i) ? 1 : 0));
    const userFlip = g.dataNodes.map((n) => (colors.get(n) === DATA_COLOR ? 1 : 0));
    const residual = hidden.map((e, i) => e ^ userFlip[i]);
    const isLogicalError =
      gMat.length > 0 &&
      gMat.some((row) => row.reduce((xor, bit, i) => xor ^ (bit & residual[i]), 0) !== 0);
    const bitsFlipped = residual.reduce((s, b) => s + b, 0);
    return { isLogicalError, bitsFlipped };
  }

  // Keep refs in sync so timer callbacks always see latest values
  useEffect(() => { graphRef.current = graph; }, [graph]);
  useEffect(() => { numErrorsRef.current = numErrors; }, [numErrors]);

  // Stable callback — uses refs, so no deps needed
  const doAdvance = useCallback(() => {
    const g = graphRef.current;
    if (!g) return;
    const ne = numErrorsRef.current;
    const ds = newSeed();
    const adj = buildAdj(g);
    assessmentModeRef.current = false;
    setNumErrors(ne); setDataSeed(ds);
    setAssessmentMode(false); setHiddenErrorNodes(new Set());
    setHiddenZErrors(new Set());
    setChallenge(null); setShowingChallenger(false);
    lastChallengeTimeRef.current = Date.now();
    advanceTimerRef.current = null;
    if (isQuantumRef.current) {
      // quantumColors memo will recompute from error sets; reset errors to new hidden ones
      // We store the initial hidden errors in quantumXErrors/quantumZErrors for the memo
      const xSet = new Set<string>();
      const zSet = new Set<string>();
      // Collect x/z check sets from current graph
      for (const n of g.checkNodes) {
        if (n.startsWith("xcheck_")) xSet.add(n);
        else if (n.startsWith("zcheck_")) zSet.add(n);
      }
      const result = computeQuantumColors(g, adj, ne, ds, xSet, zSet);
      setNodeColors(result.colors); setInitialColors(result.colors);
      setHiddenQXErrors(result.xErrorNodes);
      setHiddenQZErrors(result.zErrorNodes);
      setQuantumXErrors(new Set());
      setQuantumZErrors(new Set());
    } else {
      const colors = computeColors(g, adj, ne, ds);
      setNodeColors(colors); setInitialColors(colors);
      setQuantumXErrors(new Set());
      setQuantumZErrors(new Set());
    }
  }, []);

  const handleRandomize = useCallback(() => {
    if (!graph) return;
    if (advanceTimerRef.current !== null) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    const ds = newSeed();
    const adj = buildAdj(graph);
    assessmentModeRef.current = false;
    setDataSeed(ds);
    setAssessmentMode(false);
    setHiddenErrorNodes(new Set());
    setHiddenZErrors(new Set());
    setChallenge(null);
    setShowingChallenger(false);
    lastChallengeTimeRef.current = Date.now();
    if (isQuantum) {
      const result = computeQuantumColors(graph, adj, numErrors, ds, quantumXSet, quantumZSet);
      setNodeColors(result.colors);
      setInitialColors(result.colors);
      setHiddenQXErrors(result.xErrorNodes);
      setHiddenQZErrors(result.zErrorNodes);
      setQuantumXErrors(new Set());
      setQuantumZErrors(new Set());
    } else {
      const colors = computeColors(graph, adj, numErrors, ds);
      setNodeColors(colors);
      setInitialColors(colors);
    }
  }, [graph, numErrors, isQuantum, quantumXSet, quantumZSet]);

  const handleSubmit = useCallback(() => {
    if (!graph || assessmentModeRef.current) return;
    assessmentModeRef.current = true;
    const { isLogicalError, bitsFlipped } = isQuantum
      ? evalQuantumLogicalError(graph, adjacency, quantumXSet, quantumZSet, matLx, matLz, numErrors, dataSeed, quantumXErrors, quantumZErrors)
      : evalLogicalError(graph, matG, numErrors, dataSeed, nodeColors);
    if (isQuantum) {
      const zSeed = (dataSeed ^ 0xdeadbeef) >>> 0;
      const xHidden = pickErrorSet(graph, numErrors, dataSeed);
      const zHidden = pickErrorSet(graph, numErrors, zSeed);
      setHiddenErrorNodes(new Set(graph.dataNodes.filter((_, i) => xHidden.has(i))));
      setHiddenZErrors(new Set(graph.dataNodes.filter((_, i) => zHidden.has(i))));
    } else {
      const errorSet = pickErrorSet(graph, numErrors, dataSeed);
      setHiddenErrorNodes(new Set(graph.dataNodes.filter((_, i) => errorSet.has(i))));
      setHiddenZErrors(new Set());
    }
    const flips = encodeFlips(nodeColors, graph.dataNodes, isQuantum);
    setHistory((prev) => [
      ...prev,
      { graphId: selectedGraphId, graphName: selectedGraphName, numErrors, logicalError: isLogicalError, bitsFlipped, dataSeed, flips },
    ]);
    setAssessmentMode(true);
    setAssessmentSuccess(!isLogicalError);
    setAssessmentMessage(isLogicalError ? `Logical Error (${bitsFlipped} bit${bitsFlipped !== 1 ? "s" : ""})` : "Success!");
    if (!isLogicalError) {
      const elapsed = Date.now() - lastChallengeTimeRef.current;
      advanceTimerRef.current = setTimeout(doAdvance, Math.max(500, 2000 - elapsed));
    }
  }, [graph, adjacency, matG, matLx, matLz, numErrors, dataSeed, nodeColors, isQuantum, quantumXErrors, quantumZErrors, quantumXSet, quantumZSet, selectedGraphId, selectedGraphName, doAdvance]);

  const handleEnter = useCallback(() => {
    if (!graph || !selectedGraphId) return;

    if (!assessmentModeRef.current) {
      assessmentModeRef.current = true;
      // Phase 1: evaluate and enter assessment mode
      const { isLogicalError, bitsFlipped } = isQuantum
        ? evalQuantumLogicalError(graph, adjacency, quantumXSet, quantumZSet, matLx, matLz, numErrors, dataSeed, quantumXErrors, quantumZErrors)
        : evalLogicalError(graph, matG, numErrors, dataSeed, nodeColors);
      if (isQuantum) {
        const zSeed = (dataSeed ^ 0xdeadbeef) >>> 0;
        const xHidden = pickErrorSet(graph, numErrors, dataSeed);
        const zHidden = pickErrorSet(graph, numErrors, zSeed);
        setHiddenErrorNodes(new Set(graph.dataNodes.filter((_, i) => xHidden.has(i))));
        setHiddenZErrors(new Set(graph.dataNodes.filter((_, i) => zHidden.has(i))));
      } else {
        const errorSet = pickErrorSet(graph, numErrors, dataSeed);
        setHiddenErrorNodes(new Set(graph.dataNodes.filter((_, i) => errorSet.has(i))));
        setHiddenZErrors(new Set());
      }
      const flips = encodeFlips(nodeColors, graph.dataNodes, isQuantum);
      setHistory((prev) => [
        ...prev,
        { graphId: selectedGraphId, graphName: selectedGraphName, numErrors, logicalError: isLogicalError, bitsFlipped, dataSeed, flips },
      ]);
      setAssessmentMode(true);
      setAssessmentSuccess(!isLogicalError);
      setAssessmentMessage(isLogicalError ? `Logical Error (${bitsFlipped} bit${bitsFlipped !== 1 ? "s" : ""})` : "Success!");
      if (!isLogicalError) {
        // Auto-advance after 0.25s (but no sooner than 2s after last challenge started)
        const elapsed = Date.now() - lastChallengeTimeRef.current;
        advanceTimerRef.current = setTimeout(doAdvance, Math.max(500, 2000 - elapsed));
      }
    } else {
      // Phase 2: advance to next challenge (respecting 2s cooldown from last challenge start)
      if (advanceTimerRef.current !== null) {
        clearTimeout(advanceTimerRef.current);
        advanceTimerRef.current = null;
      }
      const remaining = Math.max(0, 2000 - (Date.now() - lastChallengeTimeRef.current));
      if (remaining > 0) {
        advanceTimerRef.current = setTimeout(doAdvance, remaining);
      } else {
        doAdvance();
      }
    }
  }, [graph, adjacency, matG, matLx, matLz, numErrors, dataSeed, nodeColors, isQuantum, quantumXErrors, quantumZErrors, quantumXSet, quantumZSet, selectedGraphId, selectedGraphName, doAdvance]);

  const handleNodeClick = useCallback(
    (node: string) => {
      if (assessmentMode || showingChallenger) return;
      if (!node.startsWith("data_")) return;
      if (isQuantum) {
        // Left click = X error (bit flip); quantumColors memo recomputes check states
        setQuantumXErrors((prev) => {
          const next = new Set(prev);
          if (next.has(node)) next.delete(node); else next.add(node);
          return next;
        });
        return;
      }
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
    [adjacency, assessmentMode, showingChallenger, isQuantum]
  );

  const handleNodeRightClick = useCallback(
    (node: string) => {
      if (!isQuantum || assessmentMode || showingChallenger) return;
      if (!node.startsWith("data_")) return;
      // Right click = Z error (phase flip); quantumColors memo recomputes check states
      setQuantumZErrors((prev) => {
        const next = new Set(prev);
        if (next.has(node)) next.delete(node); else next.add(node);
        return next;
      });
    },
    [isQuantum, assessmentMode, showingChallenger]
  );

  const toggleChallengerView = useCallback(() => {
    if (!challenge || !graph) return;
    if (showingChallenger) {
      setNodeColors(initialColors);
      setShowingChallenger(false);
    } else {
      const solved = applyFlips(initialColors, adjacency, graph.dataNodes, challenge.flips);
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Enter") handleEnter();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleEnter]);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(0);

  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        const top = containerRef.current.getBoundingClientRect().top;
        setContainerHeight(window.innerHeight - top - 8);
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <div
      ref={containerRef}
      className="flex w-full gap-3 overflow-hidden"
      style={{ height: containerHeight > 0 ? containerHeight : undefined }}
    >

      {/* Left sidebar: graph picker */}
      <div className="flex w-28 shrink-0 flex-col gap-1.5 overflow-y-auto pb-2">
        {graphList.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-zinc-400">Loading…</div>
        ) : (
          graphList.map((gm) => {
            const isSelected = gm.id === selectedGraphId;
            const checkSet = new Set(gm.checkNodes);
            return (
              <button
                key={gm.id}
                onClick={() => loadGraphById(gm.id, numErrors, newSeed())}
                className={`group flex flex-col items-center rounded-xl border p-2 transition-all hover:shadow-sm ${
                  isSelected
                    ? "border-violet-400 bg-violet-50"
                    : "border-zinc-200 bg-zinc-50 hover:border-zinc-300 hover:bg-white"
                }`}
              >
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="xMidYMid meet"
                  className="w-full aspect-square"
                >
                  {gm.edges.map(([a, b], i) => {
                    const pa = gm.positions[a];
                    const pb = gm.positions[b];
                    if (!pa || !pb) return null;
                    return (
                      <line
                        key={i}
                        x1={pa.x} y1={pa.y}
                        x2={pb.x} y2={pb.y}
                        stroke={isSelected ? "#7c3aed" : "#374151"}
                        strokeWidth={6}
                        opacity={0.25}
                      />
                    );
                  })}
                  {[...gm.checkNodes, ...gm.dataNodes].map((node) => {
                    const pos = gm.positions[node];
                    if (!pos) return null;
                    const isCheck = checkSet.has(node);
                    const thumbCheckColor = node.startsWith("xcheck_") ? X_CHECK_COLOR
                      : node.startsWith("zcheck_") ? Z_CHECK_COLOR
                      : CHECK_COLOR;
                    return (
                      <circle
                        key={node}
                        cx={pos.x}
                        cy={pos.y}
                        r={isCheck ? 22 : 28}
                        fill={isCheck ? thumbCheckColor : DATA_TOGGLED}
                        opacity={isSelected ? 1 : 0.8}
                      />
                    );
                  })}
                </svg>
                <span className={`mt-1.5 text-center text-xs font-medium leading-tight ${
                  isSelected ? "text-violet-700" : "text-zinc-600 group-hover:text-zinc-800"
                }`}>
                  {gm.name}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Center: main content */}
      <div className="flex flex-1 flex-col min-w-0 gap-2 overflow-hidden">

        {/* Challenge banner */}
        {challenge && (
          <div className="flex items-center gap-4 rounded-xl border border-orange-500/20 bg-orange-500/[0.06] px-5 py-2 text-sm">
            <span className="font-semibold text-orange-600">
              Challenge: someone got {challenge.logicalError ? "a logical error" : "success"}
            </span>
            <span className="text-zinc-500">{challenge.logicalError ? "Can you do better?" : "Can you match it?"}</span>
            <button
              onClick={toggleChallengerView}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
            >
              {showingChallenger ? "Hide solution" : "Show solution"}
            </button>
          </div>
        )}

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 shadow-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Errors</span>
            <button
              onClick={() => setNumErrors((n) => Math.max(1, n - 1))}
              disabled={!graph || numErrors <= 1}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-sm font-bold text-zinc-600 shadow-sm transition-all hover:bg-zinc-100 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            >−</button>
            <span className="min-w-[3.5rem] text-center text-sm tabular-nums text-zinc-700">
              {graph ? `${numErrors} / ${maxErrors}` : "—"}
            </span>
            <button
              onClick={() => setNumErrors((n) => Math.min(maxErrors, n + 1))}
              disabled={!graph || numErrors >= maxErrors}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-white text-sm font-bold text-zinc-600 shadow-sm transition-all hover:bg-zinc-100 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
            >+</button>
            <button
              onClick={handleRandomize}
              disabled={!graph}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-violet-500 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
            >
              Randomize
            </button>
          </div>
          {graph && (
            <button
              onClick={handleSubmit}
              disabled={assessmentMode}
              className={`rounded-lg px-5 py-1.5 text-sm font-semibold shadow-md transition-all active:scale-95 ${
                assessmentMode
                  ? "border border-zinc-300 bg-zinc-100 text-zinc-400 shadow-none cursor-default"
                  : "bg-emerald-600 text-white shadow-emerald-500/20 hover:bg-emerald-500 hover:shadow-emerald-500/30"
              }`}
            >
              Submit Score
            </button>
          )}
        </div>

        {/* Legend + Score */}
        {graph && (
          <div className="flex items-center gap-4 text-xs text-zinc-500 flex-wrap">
            {isQuantum ? (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#93c5fd]" />
                  <span className="text-zinc-400">X-check</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#fca5a5]" />
                  <span className="text-zinc-400">Z-check</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ef4444]" />
                  <span className="text-zinc-400">X err (left click)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#3b82f6]" />
                  <span className="text-zinc-400">Z err (right click)</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
                  <span className="text-zinc-400">Both</span>
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#670EFF] shadow-[0_0_6px_#670EFF]" />
                  <span className="text-zinc-400">Check</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#475569]" />
                  <span className="text-zinc-400">Data</span>
                </span>
              </>
            )}
            <span className="text-zinc-600">
              {assessmentMode
                ? (assessmentSuccess ? "Correct! Next challenge loading…" : "Press Enter for next challenge")
                : showingChallenger
                  ? "Viewing challenger's solution"
                  : isQuantum
                    ? "Left-click = X error, right-click = Z error"
                    : "Click a data node to toggle parity"}
            </span>
            <span className="ml-auto flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1">
              <span className="text-zinc-500 uppercase tracking-wide">Logical Errors</span>
              <span className={`text-lg font-bold tabular-nums ${logicalErrors === 0 ? "text-emerald-600" : "text-red-500"}`}>
                {logicalErrors}
              </span>
            </span>
          </div>
        )}

        {/* Main graph SVG */}
        {graph ? (
          <div className="relative flex-1 min-h-0">
            {assessmentMode && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className={`absolute inset-0 ${assessmentSuccess ? "bg-green-300/35" : "bg-red-300/35"}`} />
                {assessmentMessage && (
                  <span className={`relative z-10 text-2xl font-bold drop-shadow-lg ${assessmentSuccess ? "text-green-800" : "text-red-800"}`}>
                    {assessmentMessage}
                  </span>
                )}
              </div>
            )}
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
                const pa = positions[a];
                const pb = positions[b];
                if (!pa || !pb) return null;
                const renderColors = isQuantum ? (quantumColors ?? new Map()) : nodeColors;
                const colA = (assessmentMode && !a.startsWith("data_") ? initialColors : renderColors).get(a);
                const colB = (assessmentMode && !b.startsWith("data_") ? initialColors : renderColors).get(b);
                const aXTrig = colA === X_CHECK_TRIGGERED, bXTrig = colB === X_CHECK_TRIGGERED;
                const aZTrig = colA === Z_CHECK_TRIGGERED, bZTrig = colB === Z_CHECK_TRIGGERED;
                const aOrange = colA === CHECK_TOGGLED, bOrange = colB === CHECK_TOGGLED;
                const edgeColor = (aXTrig || bXTrig) ? X_CHECK_TRIGGERED
                  : (aZTrig || bZTrig) ? Z_CHECK_TRIGGERED
                  : (aOrange || bOrange) ? "#f97316"
                  : "#374151";
                const highlighted = aXTrig || bXTrig || aZTrig || bZTrig || aOrange || bOrange;
                return (
                  <line
                    key={i}
                    x1={pa.x}
                    y1={pa.y}
                    x2={pb.x}
                    y2={pb.y}
                    stroke={edgeColor}
                    strokeWidth={highlighted ? 2.5 : 1}
                    opacity={highlighted ? 0.8 : 0.5}
                  />
                );
              })}

              {/* Nodes */}
              {[...graph.checkNodes, ...graph.dataNodes].map((node) => {
                const pos = positions[node];
                if (!pos) return null;
                const isData = node.startsWith("data_");
                const renderColors = isQuantum ? (quantumColors ?? new Map()) : nodeColors;
                const colorMap = assessmentMode && !isData ? initialColors : renderColors;
                const defaultColor = isData ? DATA_COLOR : (node.startsWith("xcheck_") ? X_CHECK_COLOR : node.startsWith("zcheck_") ? Z_CHECK_COLOR : CHECK_COLOR);
                const color = colorMap.get(node) || defaultColor;
                const isTriggered = color === CHECK_TOGGLED || color === X_CHECK_TRIGGERED || color === Z_CHECK_TRIGGERED;
                const radius = isData ? 14 : 11;

                let filter: string | undefined;
                if (isTriggered) filter = "url(#glow-orange)";
                else if (!isData) filter = "url(#glow-check)";
                else if (color === DATA_TOGGLED) filter = "url(#glow-data)";

                const clickable = isData && !assessmentMode && !showingChallenger;

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
                      opacity: assessmentMode ? 0.85 : 1,
                    }}
                    onClick={() => handleNodeClick(node)}
                    onMouseDown={(e) => { if (e.button === 2) { e.preventDefault(); handleNodeRightClick(node); } }}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    <title>{node}</title>
                  </circle>
                );
              })}

              {/* Assessment: red rings on hidden X-error nodes */}
              {assessmentMode && [...hiddenErrorNodes].map((node) => {
                const pos = positions[node];
                if (!pos) return null;
                return (
                  <circle
                    key={`err-${node}`}
                    cx={pos.x}
                    cy={pos.y}
                    r={21}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth={3}
                    opacity={0.9}
                  />
                );
              })}
              {/* Assessment: blue rings on hidden Z-error nodes */}
              {assessmentMode && [...hiddenZErrors].map((node) => {
                const pos = positions[node];
                if (!pos) return null;
                return (
                  <circle
                    key={`zerr-${node}`}
                    cx={pos.x}
                    cy={pos.y}
                    r={25}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    opacity={0.9}
                  />
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            Select a code on the left to start
          </div>
        )}
      </div>

      {/* Right: History (always visible) */}
      <div className="flex w-64 shrink-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50">
        <div className="border-b border-zinc-200 px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">History</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {history.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-zinc-600">
              Select a code to start
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">#</th>
                  <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">Graph</th>
                  <th className="sticky top-0 bg-zinc-50 px-2 py-2 font-medium">Errors</th>
                  <th className="sticky top-0 bg-zinc-50 px-2 py-2 text-right font-medium">Result</th>
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
                      <span className="font-semibold text-zinc-600">{entry.graphName}</span>
                    </td>
                    <td className="px-2 py-1.5 tabular-nums text-zinc-600">
                      {entry.numErrors}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {entry.logicalError ? (
                        <span className="font-bold text-red-500" title={`${entry.bitsFlipped} bits wrong`}>
                          ✗
                        </span>
                      ) : (
                        <span className="font-bold text-emerald-600">✓</span>
                      )}
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
                  ? entry.logicalError
                    ? "You got a logical error — dare someone to do better!"
                    : "You decoded correctly — dare someone to match it!"
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
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(entry.logicalError ? "I got a logical error on this LDPC puzzle. Can you do better?" : "I decoded this LDPC puzzle correctly! Can you match it?")}&url=${encodeURIComponent(makeShareUrl(entry))}`}
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
                  href={`mailto:?subject=${encodeURIComponent("LDPC Puzzle Challenge!")}&body=${encodeURIComponent((entry.logicalError ? "I got a logical error on this LDPC puzzle. Can you do better?" : "I decoded this LDPC puzzle correctly! Can you match it?") + "\n\n" + makeShareUrl(entry))}`}
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
