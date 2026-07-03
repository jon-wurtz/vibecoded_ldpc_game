import networkx as nx

from .utils import normalize_positions


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
