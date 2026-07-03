import networkx as nx

from .utils import normalize_positions


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
        "name": "[7,1,7] Repetition Code",
        "maxErrors": 3,  # distance = n_data = 7, floor((7-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": [[a, b] for a, b in edges],
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }
