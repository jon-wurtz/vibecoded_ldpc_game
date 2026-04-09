import networkx as nx
import numpy as np
import matplotlib.pyplot as plt

def make_ldpc_code(ndata, ncheck, density):
    
    G = nx.Graph()
    for i in range(ndata):
        G.add_node(f"data_{i}", bipartite=0)
    for i in range(ncheck):
        G.add_node(f"check_{i}", bipartite=1)
    
    for i in range(ncheck):
        check_node = f"check_{i}"
        data_nodes = np.random.choice([f"data_{j}" for j in range(ndata)], size=int(density*ndata), replace=False)
        for data_node in data_nodes:
            G.add_edge(check_node, data_node)
    
    return G

def visualize_ldpc_code(G):
    colors = []
    for node in G.nodes:
        if "data_" in node:
            colors.append('#670EFF')
        else:
            #neighbors = nx.neighbors(G,node)
            #parities = [errors[int(neighbor.split("_")[1])] for neighbor in neighbors]
            colors.append('gray')
    
    
    fig, ax = plt.subplots()
    pos = nx.kamada_kawai_layout(G)
    xy = np.array([pos[node] for node in G.nodes])
    scatter = ax.scatter(xy[:, 0], xy[:, 1], c=colors, s=300, zorder=2, picker=True)
    for edge in G.edges:
        x0, y0 = pos[edge[0]]
        x1, y1 = pos[edge[1]]
        ax.plot([x0, x1], [y0, y1], color='gray', zorder=1)
    ax.set_aspect("equal")
    ax.axis('off')
    
    mapping = {node: idx for idx, node in enumerate(G.nodes)}

    current_colors = colors.copy()

    def on_pick(event):
        print("event!")
        ind = event.ind[0]
        neighbors = list(G.neighbors(list(G.nodes)[ind]))
        # Toggle color between blue and original
        if current_colors[ind] == 'k':
            current_colors[ind] = "gray"
        elif current_colors[ind] == 'gray':
            current_colors[ind] = "k"
        for neighbor in neighbors:
            if current_colors[mapping[neighbor]] == '#FF5900':
                current_colors[mapping[neighbor]] = "#670EFF"
            elif current_colors[mapping[neighbor]] == '#670EFF':
                current_colors[mapping[neighbor]] = "#FF5900"
        scatter.set_color(current_colors)
        fig.canvas.draw_idle()

    fig.canvas.mpl_connect('pick_event', on_pick)
    plt.show()
    