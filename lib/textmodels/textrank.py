# -*- coding: utf-8 -*-
from pattern.en import parse, Text, Sentence

from textmodels.stopwords import stopword_dict

# Strips suffix from string
def strip_end(text, suffix):
    if not text.endswith(suffix):
        return text
    return text[:-len(suffix)]

# Strips prefix from string
def strip_begin(text, prefix):
    if not text.startswith(prefix):
        return text
    return text[len(prefix):]

# Remove things that disturb
def clean_string(text):
    text = strip_end(text, u"’s")
    text = strip_end(text, u"’m")
    text = strip_end(text, u"’re")
    text = strip_end(text, u"’d")
    text = strip_end(text, u"'s")
    text = strip_end(text, u"'m")
    text = strip_end(text, u"'m")
    text = strip_end(text, u"'re")
    text = strip_begin(text, u'“')
    text = strip_begin(text, u'"')
    text = strip_end(text, u'“')
    text = strip_end(text, u'"')
    return text

# Returns all possible unique pairs (a,b) from list [a,b,c,d,...]
def all_pairs(items):
    return [(items[i],items[j]) for i in range(len(items)) for j in range(i+1, len(items))]

# Returns true if the specified tag is valid for a textrank node (only nouns and adjectives)
def is_valid_node_tag(tag):
    return (tag.startswith('NN') or tag.startswith('NP') or tag == 'JJ')

# Nodes in the textrank graph
class TextRankNode(object):
    def __init__(self, tag, token):
        self.score = 1.0
        self.neighbours = []
        self.tag = tag
        self.token = token

    def __str__(self):
        return u'%s:%f' % (self.token, self.score)

# Edges in the textrank graph
class TextRankEdge(object):
    def __init__(self, node_a, node_b):
        self.node_a = node_a
        self.node_b = node_b
        self.weight = 0.0

    def __str__(self):
        return u'%s - %s : %f' % (self.node_a.token, self.node_b.token, self.weight)

# The textrank graph itself
class TextRankGraph(object):
    def __init__(self):
        self.nodes = {}
        self.edges = {}
        self.EDGE_WINDOW_SIZE = 3 # 3 is a good balance in speed and quality. The result only differ a little bit from 5. For long texts much faster!
        self.DAMPING_FACTOR = 0.85 # Suggested by Google founders
        self.CONVERGENCE_THRESHOLD = 0.05 # Paper suggestion is 0.001. 0.05 is much faster (1/3) and results in identical results on tested articels.

    def create_node_for_chunk(self,chunk):
        if not self.nodes.has_key(chunk.string):
            node = TextRankNode(chunk.tag, chunk.string)
            self.nodes[chunk.string] = node

    def get_edge_for_nodes(self, node_a_key, node_b_key):
        edge_key1 = node_a_key + node_b_key
        edge_key2 = node_b_key + node_a_key

        if self.edges.has_key(edge_key1):
            return self.edges[edge_key1]
        elif self.edges.has_key(edge_key2):
            return self.edges[edge_key2]

        return None

    def get_ranked_words(self):
        sorted_nodes = sorted(self.nodes.values(), key=lambda x: x.score, reverse=True)
        return [(n.token, n.score) for n in sorted_nodes]

    def create_edges_from_window(self,start_index, word_array):
        end_index = min(start_index + self.EDGE_WINDOW_SIZE, len(word_array))
        candidates = []
        for candidate in word_array[start_index:end_index]:
            if is_valid_node_tag(candidate.tag):
                candidates.append(candidate)

        for candidate_pair in all_pairs(candidates):
            edge = self.get_edge_for_nodes(candidate_pair[0].string, candidate_pair[1].string)

            if not edge is None:
                edge.weight = edge.weight + 1.0
            else:
                edge = TextRankEdge(self.nodes[candidate_pair[0].string], self.nodes[candidate_pair[1].string])
                edge.weight = 1.0
                self.edges[candidate_pair[0].string+candidate_pair[1].string] = edge

            self.nodes[candidate_pair[0].string].neighbours.append(self.nodes[candidate_pair[1].string])
            self.nodes[candidate_pair[1].string].neighbours.append(self.nodes[candidate_pair[0].string])

    def __str__(self):
        buffer = u'Nodes:\n'
        for node in self.nodes.values():
            buffer = buffer + unicode(node) + u'\n'
        buffer = buffer + u'Edges:\n'
        for edge in self.edges.values():
            buffer = buffer + unicode(edge) + u'\n'
        return buffer

    def update_node_scoring(self, node):
        if len(node.neighbours)==0:
            return 0.0
        new_score = 0.0
        for neighbour in node.neighbours:
            neighbour_total_weight = 0.0

            for neighbour_neighbour in neighbour.neighbours:
                neighbour_edge = self.get_edge_for_nodes(neighbour_neighbour.token, neighbour.token)
                neighbour_total_weight = neighbour_total_weight + neighbour_edge.weight

            edge = self.get_edge_for_nodes(node.token, neighbour.token)
            new_score = new_score + edge.weight * neighbour.score / neighbour_total_weight

        new_score = (1.0-self.DAMPING_FACTOR) + self.DAMPING_FACTOR * new_score
        old_score = node.score
        node.score = new_score

        return abs(new_score-old_score)

    def compute_ranking(self):
        max_score_delta = 1.0
        iteration_index = 0
        while max_score_delta>=self.CONVERGENCE_THRESHOLD:
            print 'TextRank iteration %d ...' % (iteration_index)
            iteration_index = iteration_index + 1
            max_score_delta = 0.0
            for node in self.nodes.values():
                max_score_delta = max(max_score_delta, self.update_node_scoring(node))

class TaggedChunk(object):
    def __init__(self, string, tag):
        self.string = string
        self.tag = tag

# Parses, chunks and pos tags specified text and then performs textrank to compute most relevant keywords 
def get_keywords(text):
    global stopword_dict

    # Perform NLP processing (tokenization, sentence splitting, pos tagging)
    parse_result = parse(text, tokenize = True, tags = True, chunks = True, encoding = 'utf-8')

    text_object = Text(parse_result)
    all_tagged_chunks = []

    # Create graph object
    graph = TextRankGraph()
    current_chunk_string = None

    # Create nodes for all valid chunks
    for sentence in text_object.sentences:
        for word in sentence.words:
            if hasattr(word.chunk, 'tag'):
                if not word.chunk.string == current_chunk_string:
                    word_chunk_string = clean_string(word.chunk.string)
                    if is_valid_node_tag(word.chunk.tag) and (not stopword_dict.has_key(word_chunk_string.lower())):
                        chunk_object = TaggedChunk(word_chunk_string, word.chunk.tag)
                        all_tagged_chunks.append(chunk_object)
                        current_chunk_string = word.chunk.string
                        graph.create_node_for_chunk(chunk_object)
                    else:
                        current_chunk_string = None

    # Create edges using context window
    for chunk_index in range(len(all_tagged_chunks)):
        if is_valid_node_tag(all_tagged_chunks[chunk_index].tag):
            graph.create_edges_from_window(chunk_index, all_tagged_chunks)

    # Perform score computation
    graph.compute_ranking()

    # Return sorted tuples of (token, score)
    return graph.get_ranked_words()

def get_top_keywords_list(text, keyword_count):
    ranked_keywords = get_keywords(text)
    return ['"'+x[0]+'"' for x in ranked_keywords[:keyword_count]]

# Demo usage
if __name__ == '__main__':
    example_text = open('example3.txt', 'r').read()
    #ranked_words = get_keywords(example_text)
    #print ranked_words
    print u' '.join(get_top_keywords_list(example_text,20))


