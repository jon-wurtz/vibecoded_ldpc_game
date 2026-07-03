import math

from .utils import gf2_nullspace, gf2_rank, normalize_positions


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
        "name": "[23,12,7] Golay",
        "maxErrors": 3,  # distance = 7, floor((7-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": H_mat,
        "G": G_mat,
    }
