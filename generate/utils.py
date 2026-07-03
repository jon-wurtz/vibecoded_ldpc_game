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
