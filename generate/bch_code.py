import math

from .utils import gf2_nullspace, normalize_positions


def make_bch_31_16_7():
    """[31,16,7] BCH code.

    Cyclic code of length 31 with generator g(x) = m1(x)*m3(x)*m5(x),
    where mi are the minimal polynomials over GF(2) of alpha^i, with alpha
    a primitive element of GF(2^5) via primitive polynomial x^5+x^2+1.
    Cyclotomic cosets: C1={1,2,4,8,16}, C3={3,6,12,24,17}, C5={5,10,20,9,18}.
    """
    n, k = 31, 16
    feedback = 0b00101  # x^2+1: reduction rule when x^5 appears

    # Build GF(2^5) power and log tables
    exp_table = []
    v = 1
    for _ in range(n):
        exp_table.append(v)
        high = (v >> 4) & 1
        v = (v << 1) & 0x1f
        if high:
            v ^= feedback

    log_table = [None] * 32
    for i, val in enumerate(exp_table):
        log_table[val] = i

    def gf_mul(a, b):
        if a == 0 or b == 0:
            return 0
        return exp_table[(log_table[a] + log_table[b]) % n]

    def min_poly(coset):
        """Minimal polynomial of alpha^i (i in coset) as GF(2) coefficient list."""
        poly = [1]  # coefficients in GF(2^5), result will land in GF(2)
        for i in coset:
            root = exp_table[i % n]
            new_poly = [0] * (len(poly) + 1)
            for j, c in enumerate(poly):
                if c:
                    new_poly[j + 1] ^= c
                    new_poly[j] ^= gf_mul(c, root)
            poly = new_poly
        return poly  # all entries will be 0 or 1

    def poly_mul_gf2(a, b):
        result = [0] * (len(a) + len(b) - 1)
        for i, ai in enumerate(a):
            for j, bj in enumerate(b):
                result[i + j] ^= ai & bj
        return result

    m1 = min_poly([1, 2, 4, 8, 16])
    m3 = min_poly([3, 6, 12, 24, 17])
    m5 = min_poly([5, 10, 20, 9, 18])
    g = poly_mul_gf2(poly_mul_gf2(m1, m3), m5)  # degree 15

    # Generator matrix: rows are x^i * g(x) for i = 0..k-1 (no reduction needed,
    # max degree = 15+15 = 30 < 31)
    G_mat = []
    for i in range(k):
        row = [0] * n
        for j, c in enumerate(g):
            row[i + j] ^= c
        G_mat.append(row)

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
        "id": "bch-31-16-7",
        "name": "[31,16,7] BCH",
        "maxErrors": 3,  # floor((7-1)/2)
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": H_mat,
        "G": G_mat,
    }
