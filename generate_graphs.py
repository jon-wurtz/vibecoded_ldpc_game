import json
import os

from generate.bch_code import make_bch_31_16_7
from generate.golay_code import make_golay_code
from generate.hamming_code import make_hamming_code
from generate.levi_cage import make_levi_cage
from generate.mcgee_graph import make_mcgee_graph
from generate.reed_muller_code import make_reed_muller_32_6_16
from generate.repetition_code import make_repetition_code

GRAPHS_DIR = os.path.join(os.path.dirname(__file__), "graphs")
os.makedirs(GRAPHS_DIR, exist_ok=True)

if __name__ == "__main__":
    graphs = [
        make_repetition_code(n_data=7),
        make_hamming_code(),
        # make_golay_code(),
        # make_levi_cage(),
        make_mcgee_graph(),
        make_reed_muller_32_6_16(),
        # make_bch_31_16_7(),
    ]
    for g in graphs:
        path = os.path.join(GRAPHS_DIR, f"{g['id']}.json")
        with open(path, "w") as f:
            json.dump(g, f, indent=2)
        print(f"Wrote {path}")
