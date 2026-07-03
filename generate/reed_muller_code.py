import math

from .utils import gf2_nullspace, normalize_positions


def make_reed_muller_32_6_16():
    """[32,6,16] first-order Reed-Muller code R(1,5).

    G has 6 rows: the all-ones vector plus the 5 coordinate functions on {0,1}^5.
    H is the null space of G (26 rows, the dual code R(3,5)).
    """
    n, k = 32, 6

    G_mat = [[1] * n]
    for bit in range(5):
        G_mat.append([(j >> bit) & 1 for j in range(n)])

    H_mat = gf2_nullspace(G_mat)

    data_nodes = [f"data_{i}" for i in range(n)]
    check_nodes = [f"check_{i}" for i in range(len(H_mat))]

    edges = []
    for i, row in enumerate(H_mat):
        for j, val in enumerate(row):
            if val:
                edges.append([f"check_{i}", f"data_{j}"])

    pos = {}
    for i in range(n):
        a = 2 * math.pi * i / n - math.pi / 2
        pos[f"data_{i}"] = (math.cos(a), math.sin(a))
    for i in range(len(H_mat)):
        a = 2 * math.pi * i / len(H_mat) - math.pi / 2
        pos[f"check_{i}"] = (0.45 * math.cos(a), 0.45 * math.sin(a))

    return {
        "id": "reed-muller-32-6-16",
        "name": "[32,6,16] Reed-Muller",
        "maxErrors": 7,  # floor((16-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": H_mat,
        "G": G_mat,
    }
