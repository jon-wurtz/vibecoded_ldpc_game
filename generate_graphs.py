import json
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
        "maxErrorProb": 0.4,
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
        "maxErrorProb": 0.4,
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": bipartite_edges,
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }


if __name__ == "__main__":
    graphs = [make_repetition_code(n_data=7), make_graph_code(n_vertices=10, connectivity=4)]
    for g in graphs:
        path = os.path.join(GRAPHS_DIR, f"{g['id']}.json")
        with open(path, "w") as f:
            json.dump(g, f, indent=2)
        print(f"Wrote {path}")
