import math

import networkx as nx

from .utils import normalize_positions


def make_mcgee_graph():
    """(3,7)-cage: the unique 24-vertex 3-regular graph of girth 7.
    Also called the McGee graph.
    Tanner graph: 24 check nodes and 36 data nodes, each of weight 3.
    """
    # Construct via LCF notation [-12, 7, -7]^8 on 24 vertices
    n = 24
    lcf = [-12, 7, -7]
    raw = nx.Graph()
    raw.add_nodes_from(range(n))
    for i in range(n):
        raw.add_edge(i, (i + 1) % n)
    for i in range(n):
        raw.add_edge(i, (i + lcf[i % len(lcf)]) % n)

    G_seed = raw
    n_vertices = G_seed.number_of_nodes()

    edges_list = sorted(G_seed.edges())
    n_e = len(edges_list)
    n_v = n_vertices
    edge_to_idx = {e: i for i, e in enumerate(edges_list)}

    data_nodes = [f"data_{i}" for i in range(n_e)]
    check_nodes = [f"check_{v}" for v in range(n_v)]

    B = nx.Graph()
    bipartite_edges = []
    for i, (u, v) in enumerate(edges_list):
        d, cu, cv = f"data_{i}", f"check_{u}", f"check_{v}"
        B.add_edge(d, cu)
        B.add_edge(d, cv)
        bipartite_edges.append([d, cu])
        bipartite_edges.append([d, cv])

    H = [[0] * n_e for _ in range(n_v)]
    for v in range(n_v):
        for u in G_seed.neighbors(v):
            e = (min(v, u), max(v, u))
            H[v][edge_to_idx[e]] = 1

    cycles = nx.minimum_cycle_basis(G_seed)
    G_mat = []
    for cycle in cycles:
        row = [0] * n_e
        for j in range(len(cycle)):
            a, b = cycle[j], cycle[(j + 1) % len(cycle)]
            e = (min(a, b), max(a, b))
            row[edge_to_idx[e]] = 1
        G_mat.append(row)

    # Check nodes placed uniformly on outer circle in LCF vertex order,
    # reflecting the Z_24 cyclic symmetry of the Hamiltonian backbone.
    # Data nodes placed at scaled midpoints of their endpoint check nodes.
    # The 4 antipodal edges (offset -12, e.g. 0-12, 3-15, 6-18, 9-21)
    # have midpoints at the origin, so they are placed on a small inner ring
    # at the angle of their lower-indexed endpoint instead.
    R = 1.0
    pos = {}
    for v in range(n_v):
        a = 2 * math.pi * v / n_v - math.pi / 2
        pos[f"check_{v}"] = (R * math.cos(a), R * math.sin(a))
    for i, (u, v) in enumerate(edges_list):
        cu, cv_pos = pos[f"check_{u}"], pos[f"check_{v}"]
        mx, my = (cu[0] + cv_pos[0]) / 2, (cu[1] + cv_pos[1]) / 2
        if math.hypot(mx, my) < 1e-6:
            a = 2 * math.pi * u / n_v - math.pi / 2
            pos[f"data_{i}"] = (0.15 * math.cos(a), 0.15 * math.sin(a))
        else:
            pos[f"data_{i}"] = (0.75 * mx, 0.75 * my)

    return {
        "id": "mcgee-graph",
        "name": "[24,13,7] McGee Graph",
        "maxErrors": 3,  # girth = 7, floor((7-1)/2) = 3
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": bipartite_edges,
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }
