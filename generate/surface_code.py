from .utils import normalize_positions


def make_surface_code_d7():
    """[49,1,7] rotated surface code (distance-7).

    Data qubits on a 7x7 grid. X-type stabilizers (xcheck_N) detect Z errors;
    Z-type stabilizers (zcheck_N) detect X errors. Alternating X/Z plaquettes in
    a checkerboard pattern with X half-plaquettes on left/right boundaries and
    Z half-plaquettes on top/bottom boundaries.
    """
    d = 7
    n = d * d  # 49 data qubits

    def qubit_idx(r, c):
        return r * d + c

    data_nodes = [f"data_{i}" for i in range(n)]
    x_checks = []  # list of (name, [qubit_indices])
    z_checks = []
    pos = {}

    for r in range(d):
        for c in range(d):
            pos[f"data_{qubit_idx(r, c)}"] = (float(c), float(r))

    # Interior plaquettes: alternating X/Z checkerboard
    for pr in range(d - 1):
        for pc in range(d - 1):
            qubits = [
                qubit_idx(pr, pc),
                qubit_idx(pr, pc + 1),
                qubit_idx(pr + 1, pc),
                qubit_idx(pr + 1, pc + 1),
            ]
            cx, cy = pc + 0.5, pr + 0.5
            if (pr + pc) % 2 == 0:
                name = f"xcheck_{len(x_checks)}"
                x_checks.append((name, qubits))
                pos[name] = (cx, cy)
            else:
                name = f"zcheck_{len(z_checks)}"
                z_checks.append((name, qubits))
                pos[name] = (cx, cy)

    # Left boundary X half-plaquettes (rows 0,2,4)
    for r in range(0, d - 1, 2):
        name = f"xcheck_{len(x_checks)}"
        x_checks.append((name, [qubit_idx(r, 0), qubit_idx(r + 1, 0)]))
        pos[name] = (-0.5, r + 0.5)

    # Right boundary X half-plaquettes (rows 1,3,5)
    for r in range(1, d - 1, 2):
        name = f"xcheck_{len(x_checks)}"
        x_checks.append((name, [qubit_idx(r, d - 1), qubit_idx(r + 1, d - 1)]))
        pos[name] = (d - 0.5, r + 0.5)

    # Top boundary Z half-plaquettes (cols 1,3,5)
    for c in range(1, d - 1, 2):
        name = f"zcheck_{len(z_checks)}"
        z_checks.append((name, [qubit_idx(0, c), qubit_idx(0, c + 1)]))
        pos[name] = (c + 0.5, -0.5)

    # Bottom boundary Z half-plaquettes (cols 0,2,4)
    for c in range(0, d - 1, 2):
        name = f"zcheck_{len(z_checks)}"
        z_checks.append((name, [qubit_idx(d - 1, c), qubit_idx(d - 1, c + 1)]))
        pos[name] = (c + 0.5, d - 0.5)

    x_check_nodes = [name for name, _ in x_checks]
    z_check_nodes = [name for name, _ in z_checks]

    # Hx (24x49): X-stabilizer matrix, detects Z errors
    Hx = [[0] * n for _ in range(len(x_checks))]
    for i, (_, qubits) in enumerate(x_checks):
        for q in qubits:
            Hx[i][q] = 1

    # Hz (24x49): Z-stabilizer matrix, detects X errors
    Hz = [[0] * n for _ in range(len(z_checks))]
    for i, (_, qubits) in enumerate(z_checks):
        for q in qubits:
            Hz[i][q] = 1

    edges = []
    for name, qubits in x_checks:
        for q in qubits:
            edges.append([name, f"data_{q}"])
    for name, qubits in z_checks:
        for q in qubits:
            edges.append([name, f"data_{q}"])

    # Logical X: row d//2=3 (horizontal X chain, commutes with all Z stabilizers)
    Lx = [0] * n
    for c in range(d):
        Lx[qubit_idx(d // 2, c)] = 1

    # Logical Z: col d//2=3 (vertical Z chain, commutes with all X stabilizers)
    Lz = [0] * n
    for r in range(d):
        Lz[qubit_idx(r, d // 2)] = 1

    
    
    return {
        "id": "surface-code-d7",
        "name": "Surface Code d=7",
        "maxErrors": 3,  # floor((7-1)/2)
        "checkNodes": x_check_nodes + z_check_nodes,
        "xCheckNodes": x_check_nodes,
        "zCheckNodes": z_check_nodes,
        "dataNodes": data_nodes,
        "edges": edges,
        "positions": normalize_positions(pos),
        "H": Hz,    # Hz detects X errors (backward compat)
        "G": [Lx],  # one logical qubit
        "Hx": Hx,
        "Hz": Hz,
        "Lx": Lx,
        "Lz": Lz,
    }
