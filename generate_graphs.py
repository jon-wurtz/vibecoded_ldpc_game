import json
import math
import os
import networkx as nx

GRAPHS_DIR = os.path.join(os.path.dirname(__file__), "graphs")
os.makedirs(GRAPHS_DIR, exist_ok=True)


def normalize_positions(pos_dict, padding=60, canvas=1000):
    xs = [v[0] for v in pos_dict.values()]
    ys = [v[1] for v in pos_dict.values()]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    range_x = max_x - min_x or 1.0
    range_y = max_y - min_y or 1.0
    inner = canvas - 2 * padding
    return {
        node: {
            "x": padding + (x - min_x) / range_x * inner,
            "y": padding + (y - min_y) / range_y * inner,
        }
        for node, (x, y) in pos_dict.items()
    }


def gf2_rank(rows):
    """Rank of a matrix over GF(2)."""
    A = [row[:] for row in rows]
    m, n = len(A), len(A[0])
    rank = 0
    for col in range(n):
        found = next((r for r in range(rank, m) if A[r][col]), -1)
        if found == -1:
            continue
        A[rank], A[found] = A[found], A[rank]
        for r in range(m):
            if r != rank and A[r][col]:
                A[r] = [A[r][j] ^ A[rank][j] for j in range(n)]
        rank += 1
    return rank


def gf2_nullspace(H):
    """Basis for the null space of H over GF(2): vectors x s.t. H @ x = 0."""
    m = len(H)
    if m == 0:
        return []
    n = len(H[0])
    A = [row[:] for row in H]
    pivot_cols_ordered = []
    pivot_of_col = {}
    pivot_row = 0
    for col in range(n):
        found = next((r for r in range(pivot_row, m) if A[r][col]), -1)
        if found == -1:
            continue
        A[pivot_row], A[found] = A[found], A[pivot_row]
        for r in range(m):
            if r != pivot_row and A[r][col]:
                A[r] = [A[r][j] ^ A[pivot_row][j] for j in range(n)]
        pivot_of_col[col] = pivot_row
        pivot_cols_ordered.append(col)
        pivot_row += 1
    free_cols = [c for c in range(n) if c not in pivot_of_col]
    basis = []
    for fc in free_cols:
        vec = [0] * n
        vec[fc] = 1
        for i, pc in enumerate(pivot_cols_ordered):
            vec[pc] = A[i][fc]
        basis.append(vec)
    return basis


def make_repetition_code(n_data=7):
    n_check = n_data - 1
    data_nodes = [f"data_{i}" for i in range(n_data)]
    check_nodes = [f"check_{i}" for i in range(n_check)]
    edges = (
        [(f"data_{i}", f"check_{i}") for i in range(n_check)]
        + [(f"check_{i}", f"data_{i+1}") for i in range(n_check)]
    )

    G = nx.Graph()
    for n in data_nodes + check_nodes:
        G.add_node(n)
    for a, b in edges:
        G.add_edge(a, b)

    pos = {}
    for i, n in enumerate(data_nodes):
        pos[n] = (i * 2, 0)
    for i, n in enumerate(check_nodes):
        pos[n] = (i * 2 + 1, 1)

    # H: parity check matrix, rows=checks, cols=data
    H = [[0] * n_data for _ in range(n_check)]
    for i in range(n_check):
        H[i][i] = 1
        H[i][i + 1] = 1

    # G: generator/decoding matrix — all-ones (1 logical bit)
    G_mat = [[1] * n_data]

    return {
        "id": "repetition-code",
        "name": "Repetition Code",
        "maxErrors": 3,  # distance = n_data = 7, floor((7-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": [[a, b] for a, b in edges],
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }


def make_graph_code(n_vertices=10, connectivity=4, seed=42):
    """
    Cycle code on a random regular graph.
    data nodes  = edges of G_seed   (the error-prone bits)
    check nodes = vertices of G_seed (degree-sum parity checks)
    G           = minimum cycle basis (logical operators over edges)
    """
    G_seed = nx.random_regular_graph(connectivity, n_vertices, seed=seed)

    edges_list = sorted(G_seed.edges())
    n_e = len(edges_list)
    n_v = n_vertices
    edge_to_idx = {e: i for i, e in enumerate(edges_list)}

    data_nodes = [f"data_{i}" for i in range(n_e)]
    check_nodes = [f"check_{v}" for v in range(n_v)]

    # Bipartite graph for rendering: data_i ↔ check_u, check_v
    B = nx.Graph()
    bipartite_edges = []
    for i, (u, v) in enumerate(edges_list):
        d, cu, cv = f"data_{i}", f"check_{u}", f"check_{v}"
        B.add_edge(d, cu)
        B.add_edge(d, cv)
        bipartite_edges.append([d, cu])
        bipartite_edges.append([d, cv])

    # H: vertex × edge incidence matrix
    H = [[0] * n_e for _ in range(n_v)]
    for v in range(n_v):
        for u in G_seed.neighbors(v):
            e = (min(v, u), max(v, u))
            H[v][edge_to_idx[e]] = 1

    # G: minimum cycle basis expressed as edge indicator vectors
    cycles = nx.minimum_cycle_basis(G_seed)
    G_mat = []
    for cycle in cycles:
        row = [0] * n_e
        for j in range(len(cycle)):
            a, b = cycle[j], cycle[(j + 1) % len(cycle)]
            e = (min(a, b), max(a, b))
            row[edge_to_idx[e]] = 1
        G_mat.append(row)

    pos_raw = nx.kamada_kawai_layout(B)
    pos = {node: (float(pos_raw[node][0]), float(pos_raw[node][1])) for node in B.nodes()}

    return {
        "id": "graph-code",
        "name": "Graph Code",
        "maxErrors": 1,  # girth = 3, floor((3-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": bipartite_edges,
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }


def make_hamming_code():
    """[7,4,3] Hamming code: 7 data bits, 3 parity checks, distance 3."""
    n, r = 7, 3
    data_nodes = [f"data_{i}" for i in range(n)]
    check_nodes = [f"check_{i}" for i in range(r)]

    # H: column j has the binary representation of (j+1), row = bit position
    H = [[(j + 1) >> bit & 1 for j in range(n)] for bit in range(r)]

    B = nx.Graph()
    edges = []
    for i, row in enumerate(H):
        for j, val in enumerate(row):
            if val:
                B.add_edge(f"check_{i}", f"data_{j}")
                edges.append([f"check_{i}", f"data_{j}"])

    G_mat = gf2_nullspace(H)  # 4 logical codewords

    pos_raw = nx.kamada_kawai_layout(B)
    pos = {node: (float(pos_raw[node][0]), float(pos_raw[node][1])) for node in B.nodes()}

    return {
        "id": "hamming-7-4-3",
        "name": "Hamming [7,4,3]",
        "maxErrors": 1,  # distance = 3, floor((3-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }


def make_golay_code():
    """[23,12,7] Golay code: 23 data bits, 11 parity checks, distance 7.

    Built as a cyclic code via generator polynomial
    g(x) = 1 + x^2 + x^4 + x^5 + x^6 + x^10 + x^11.
    The parity check matrix (dual code) has 11 rows each of weight 8.

    Layout uses the Z_23 cyclic structure directly:
    - Data nodes i = 0..22 sit at angle 2πi/23 on the outer circle.
    - Each check node's angle is the circular centroid of its 8 connected
      data positions on the Z_23 circle; it is placed on an inner ring.
    """
    n, k = 23, 12
    r = n - k  # 11 checks
    data_nodes = [f"data_{i}" for i in range(n)]
    check_nodes = [f"check_{i}" for i in range(r)]

    # Generator matrix G (k×n): row i is x^i * g(x) mod x^23 + 1
    g_offsets = [0, 2, 4, 5, 6, 10, 11]
    G_mat = []
    for i in range(k):
        row = [0] * n
        for p in g_offsets:
            row[(i + p) % n] ^= 1
        G_mat.append(row)

    # H: null space of G gives rows of the parity check matrix (dual code, weight 8)
    H_mat = gf2_nullspace(G_mat)

    # --- Algebraic layout based on Z_23 cyclic structure ---
    # Build circulant H: shift the seed row by 0, 2, 4, ..., 20 in Z_23.
    # Step-2 spacing gives 11 distinct shifts covering Z_23, uniform layout.
    seed = gf2_nullspace(G_mat)[0]
    chosen_shifts = [2 * i for i in range(r)]  # [0, 2, 4, ..., 20]
    H_mat = [[seed[(j - s) % n] for j in range(n)] for s in chosen_shifts]
    if gf2_rank(H_mat) < r:
        # Fallback: use raw nullspace basis
        H_mat = gf2_nullspace(G_mat)
        chosen_shifts = list(range(r))

    R_data = 1.0
    R_check = 0.42  # inner ring for check nodes

    pos = {}

    # Data nodes: evenly around the unit circle, starting at the top
    for i in range(n):
        a = 2 * math.pi * i / n - math.pi / 2
        pos[f"data_{i}"] = (R_data * math.cos(a), R_data * math.sin(a))

    # Check_ci (shift s) placed at angle 2π*s/23 on inner circle
    for ci, s in enumerate(chosen_shifts):
        a = 2 * math.pi * s / n - math.pi / 2
        pos[f"check_{ci}"] = (R_check * math.cos(a), R_check * math.sin(a))

    edges = []
    for i, row in enumerate(H_mat):
        for j, val in enumerate(row):
            if val:
                edges.append([f"check_{i}", f"data_{j}"])

    return {
        "id": "golay-23-12-7",
        "name": "Golay [23,12,7]",
        "maxErrors": 3,  # distance = 7, floor((7-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": H_mat,
        "G": G_mat,
    }


def make_levi_cage():
    """(3,8)-cage: the unique 30-vertex 3-regular graph of girth 8.
    Also called the Tutte-Coxeter graph / Levi graph of GQ(2,2).
    Tanner graph: 15 data nodes and 15 check nodes, each of weight 3.
    """
    # Construct via LCF notation [-13,-9,7,-7,9,13]^5 on 30 vertices
    n = 30
    lcf = [-13, -9, 7, -7, 9, 13]
    raw = nx.Graph()
    raw.add_nodes_from(range(n))
    for i in range(n):
        raw.add_edge(i, (i + 1) % n)
    for i in range(n):
        raw.add_edge(i, (i + lcf[i % len(lcf)]) % n)

    G_seed = raw
    n_vertices = G_seed.number_of_nodes()

    # Copied from make_graph_code, but with fixed graph and girth 8
    edges_list = sorted(G_seed.edges())
    n_e = len(edges_list)
    n_v = n_vertices
    edge_to_idx = {e: i for i, e in enumerate(edges_list)}

    data_nodes = [f"data_{i}" for i in range(n_e)]
    check_nodes = [f"check_{v}" for v in range(n_v)]

    # Bipartite graph for rendering: data_i ↔ check_u, check_v
    B = nx.Graph()
    bipartite_edges = []
    for i, (u, v) in enumerate(edges_list):
        d, cu, cv = f"data_{i}", f"check_{u}", f"check_{v}"
        B.add_edge(d, cu)
        B.add_edge(d, cv)
        bipartite_edges.append([d, cu])
        bipartite_edges.append([d, cv])

    # H: vertex × edge incidence matrix
    H = [[0] * n_e for _ in range(n_v)]
    for v in range(n_v):
        for u in G_seed.neighbors(v):
            e = (min(v, u), max(v, u))
            H[v][edge_to_idx[e]] = 1

    # G: minimum cycle basis expressed as edge indicator vectors
    cycles = nx.minimum_cycle_basis(G_seed)
    G_mat = []
    for cycle in cycles:
        row = [0] * n_e
        for j in range(len(cycle)):
            a, b = cycle[j], cycle[(j + 1) % len(cycle)]
            e = (min(a, b), max(a, b))
            row[edge_to_idx[e]] = 1
        G_mat.append(row)

    # Check nodes = cage vertices, placed uniformly on a circle in LCF vertex order.
    # Data nodes = cage edges, placed at the midpoint of their two endpoint vertices
    # and scaled inward so they form distinct inner rings by edge length.
    R = 1.0
    pos = {}
    for v in range(n_v):
        a = 2 * math.pi * v / n_v - math.pi / 2
        pos[f"check_{v}"] = (R * math.cos(a), R * math.sin(a))
    for i, (u, v) in enumerate(edges_list):
        cu, cv = pos[f"check_{u}"], pos[f"check_{v}"]
        mx, my = (cu[0] + cv[0]) / 2, (cu[1] + cv[1]) / 2
        pos[f"data_{i}"] = (0.75 * mx, 0.75 * my)

    return {
        "id": "levi-cage",
        "name": "[30,16,8] Levi Graph",
        "maxErrors": 4,
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": bipartite_edges,
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }
    

if __name__ == "__main__":
    graphs = [
        make_repetition_code(n_data=7),
        make_hamming_code(),
        make_golay_code(),
        make_graph_code(n_vertices=10, connectivity=4),
        make_levi_cage(),
    ]
    for g in graphs:
        path = os.path.join(GRAPHS_DIR, f"{g['id']}.json")
        with open(path, "w") as f:
            json.dump(g, f, indent=2)
        print(f"Wrote {path}")
