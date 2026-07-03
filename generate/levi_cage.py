import math

import networkx as nx

from .utils import normalize_positions


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
