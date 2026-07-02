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
    return {
        "id": "repetition-code",
        "name": "Repetition Code",
        "maxErrorProb": 0.4,
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": [[a, b] for a, b in edges],
        "positions": normalize_positions(pos),
    }

def make_graph_code(n_checks = 20, connectivity = 4):
    G_seed:nx.Graph = nx.random_regular_graph(connectivity, n_checks)
    
    pos_seed = nx.kamada_kawai_layout(G_seed)
    
    G = nx.Graph()
    pos = {}
    for i, edge in enumerate(G_seed.edges()):
        check = f"check_{i}"
        node1 = f"data_{edge[0]}"
        node2 = f"data_{edge[1]}"
        G.add_node(check)
        G.add_node(node1)
        G.add_node(node2)
        G.add_edge(check, node1)
        G.add_edge(check, node2)
        pos[node1] = pos_seed[edge[0]]
        pos[node2] = pos_seed[edge[1]]
        pos[check] = ((pos_seed[edge[0]][0] + pos_seed[edge[1]][0]) / 2, (pos_seed[edge[0]][1] + pos_seed[edge[1]][1]) / 2)
    
    data_nodes = [f"data_{i}" for i in range(n_checks)]
    check_nodes = [f"check_{i}" for i in range(len(G_seed.edges()))]
    
    return {
        "id": "graph-code",
        "name": "Graph Code",
        "maxErrorProb": 0.4,
        "checkNodes": check_nodes,
        "dataNodes": data_nodes,
        "edges": [[a, b] for a, b in G.edges()],
        "positions": normalize_positions(pos),
    }

if __name__ == "__main__":
    graphs = [make_repetition_code(n_data=7), make_graph_code(n_checks=10, connectivity=4)]
    for g in graphs:
        path = os.path.join(GRAPHS_DIR, f"{g['id']}.json")
        with open(path, "w") as f:
            json.dump(g, f, indent=2)
        print(f"Wrote {path}")
