import networkx as nx

from .utils import gf2_nullspace, normalize_positions


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
        "name": "[7,4,3] Hamming",
        "maxErrors": 1,  # distance = 3, floor((3-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": H,
        "G": G_mat,
    }
