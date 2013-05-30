# -*- coding: utf-8 -*-
from itertools import combinations
from pattern.en import parse, Text

from application.utils import replace_unicode_character
# Load stopwords
from lib.textmodels.stopwords import stopword_dict



def strip_end(text, suffix):
    """
    Strips suffix from string
    """

    if not text.endswith(suffix):
        return text
    return text[:-len(suffix)]


def strip_begin(text, prefix):
    """
    Strips prefix from string
    """
    if not text.startswith(prefix):
        return text
    return text[len(prefix):]


def clean_string(text):
    """
    Remove things that disturb
    """
    clean_string = replace_unicode_character(text)
    return clean_string


def all_pairs(items):
    """
    Given an iterable returns a sequence of pairs of combinations.
    """
    return [pair for pair in combinations(items, 2)]


def is_valid_node_tag(tag):
    """
    Returns True if the specified tag is valid for a textrank node
    (only nouns and adjectives)
    """
    return (tag.startswith('NN') or tag.startswith('NP') or tag == 'JJ')


class TextRankNode(object):
    """
    Represents a node in the textrank graph.
    """
    def __init__(self, tag, token):
        self.score = 1.0
        self.neighbours = []
        self.tag = tag
        self.token = token

    def __str__(self):
        return u'%s:%f' % (self.token, self.score)


class TextRankEdge(object):
    """
    Represents an edge in a textrank graph.
    """
    def __init__(self, node_a, node_b):
        self.node_a = node_a
        self.node_b = node_b
        self.weight = 0.0

    def __str__(self):
        return u'%s - %s : %f' % (
            self.node_a.token, self.node_b.token, self.weight)


class TextRankGraph(object):
    """
    The textrank graph itself.
    """
    # 3 is a good balance in speed and quality. The result only differ a
    # little bit from 5. For long texts much faster!
    EDGE_WINDOW_SIZE = 3

    # Suggested by Google founders
    DAMPING_FACTOR = 0.85

    # Paper suggestion is 0.001. 0.05 is much faster (1/3) and results in
    # identical results on tested articels.
    CONVERGENCE_THRESHOLD = 0.05

    def __init__(self):
        self.nodes = {}
        self.edges = {}

    def create_node_for_chunk(self, chunk):
        """
        Create a node based on the given chunk. Checks if the node
        is not already in the nodes of the graph.
        """
        if not chunk.string in self.nodes.keys():
            node = TextRankNode(chunk.tag, chunk.string)
            self.nodes[chunk.string] = node

    def get_edge_for_nodes(self, node_a_key, node_b_key):
        """
        Check if there's an edge between node a and node b. If so, return it,
        otherwise returns None
        """
        edge_key1 = node_a_key + node_b_key
        edge_key2 = node_b_key + node_a_key

        if edge_key1 in self.edges.keys():
            return self.edges[edge_key1]
        elif edge_key2 in self.edges.keys():
            return self.edges[edge_key2]

        return None

    def get_ranked_words(self):
        sorted_nodes = sorted(self.nodes.values(), key=lambda x: x.score, reverse=True)
        return [(n.token, n.score) for n in sorted_nodes]

    def create_edges_from_window(self, start_index, word_array):
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
                self.edges[candidate_pair[0].string + candidate_pair[1].string] = edge

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

    def get_neighbour_total_weight(self, node):
        """
        What does it do?
        """
        neighbour_total_weight = 0.0
        for neighbour in node.neighbours:
            neighbour_edge = self.get_edge_for_nodes(
                neighbour.token, node.token)
            neighbour_total_weight = \
                    neighbour_total_weight + neighbour_edge.weight
        return neighbour_total_weight

    def update_node_scoring(self, node):
        if len(node.neighbours) == 0:
            return 0.0
        new_score = 0.0
        for neighbour in node.neighbours:
            # TODO: get's replace through get_neighbour_total_weight
            neighbour_total_weight = 0.0
            for neighbour_neighbour in neighbour.neighbours:
                neighbour_edge = self.get_edge_for_nodes(neighbour_neighbour.token, neighbour.token)
                neighbour_total_weight = neighbour_total_weight + neighbour_edge.weight

            edge = self.get_edge_for_nodes(node.token, neighbour.token)
            new_score = new_score + edge.weight * neighbour.score / neighbour_total_weight

        new_score = (1.0 - self.DAMPING_FACTOR) + self.DAMPING_FACTOR * new_score
        old_score = node.score
        node.score = new_score

        return abs(new_score - old_score)

    def compute_ranking(self):
        max_score_delta = 1.0
        iteration_index = 0
        while max_score_delta >= self.CONVERGENCE_THRESHOLD:
            print 'TextRank iteration %d ...' % (iteration_index)
            iteration_index = iteration_index + 1
            max_score_delta = 0.0
            for node in self.nodes.values():
                max_score_delta = max(max_score_delta, self.update_node_scoring(node))


class TaggedChunk(object):
    def __init__(self, string, tag):
        self.string = string
        self.tag = tag


def get_keywords(text):
    """
    Parses, chunks and pos tags specified text and then performs textrank
    to compute most relevant keywords.
    """
    global stopword_dict

    # Perform NLP processing (tokenization, sentence splitting, pos tagging)
    parse_result = parse(text)

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
    return [x[0] for x in ranked_keywords[:keyword_count]]

# Demo usage
import sys
import os
if __name__ == '__main__':
    file_to_read = os.path.abspath(sys.argv.pop())
    #ranked_words = get_keywords(example_text)
    #print ranked_words
    with open(file_to_read) as example_file:
        example_text = example_file.read()
        print ' '.join(get_top_keywords_list(example_text, 20))
