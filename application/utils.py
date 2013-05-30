# -*- coding: utf-8 -*-
from pattern.en import parsetree

_UNICODE_REPLACEMENTS = {
    u'—': '-',
    u'“': '"',
    u'’': "'",
    u'“': '"',
    u'”': '"',
}

def is_relevant_chunk(chunk):
    """
    Returns the chunk if it's a NP.
    """
    if chunk.type in ('NP',):
        return chunk

def get_relevant_chunks(text):
    """
    Returns relevant chunks from the given text.
    """
    chunks = []
    for sentence in parsetree(text):
        chunks.extend(map(is_relevant_chunk, sentence.chunks))
    relevant_chunks = filter(bool, chunks)

    return relevant_chunks

def check_chunk_head(chunk, tags):
    """
    Returns True if the chunk's head is in the given tags.
    """
    if chunk.head.type in tags:
        return True

    return False

def separate_chunks(chunks):
    """
    Returns a tuple where the first element is a list of chunks where the head
    is a normal nouns (NN, NNS). The second element is a list of chunks where 
    the head is a proper noun (NNP, NNPS).
    """
    normal_noun_chunks = [chunk for chunk in chunks 
            if check_chunk_head(chunk, ('NN', 'NNS'))]
    
    proper_noun_chunks = [chunk for chunk in chunks
            if check_chunk_head(chunk, ('NNP', 'NNPS'))]
    
    return (normal_noun_chunks, proper_noun_chunks)

def get_frequencies(chunk_list):
    """
    Returns a sorted list of tuples (frequency, head, chunks).
    """
    head_list = [chunk.head.string for chunk in chunk_list]
    head_frequency = [(el, head_list.count(el)) for el in set(head_list)]
    
    frequency_list = []
    for head, frequency in head_frequency:
        chunks_for_head = []
        for chunk in chunk_list:
            if chunk.head.string == head:
                chunks_for_head.append(chunk)
        frequency_list.append((frequency, head, chunks_for_head))

    return sorted(frequency_list, key=lambda x: x[0], reverse=True)

def get_presentation_chunks(complex_chunk_list):
    presentation_list = []
    for frequency, head, chunks in complex_chunk_list:
        entry = {'frequency': frequency, 'head': head, 
                'chunks': [chunk.string for chunk in chunks]}
        presentation_list.append(entry)
    return presentation_list

def get_sorted_chunks(text, n=10):
    """
    Returns a tuple (common noun based chunks, proper noun based chunks) for
    representation purposes.
    Each element in the tuple is a sorted list of tuples 
    (frequency, head, list of chunk strings).
    """
    text = replace_unicode_character(text)
    relevant_chunks = get_relevant_chunks(text)    
    # get chunks already sorted and with frequency
    normal_noun_chunks, proper_noun_chunks = map(get_frequencies,
            separate_chunks(relevant_chunks))

    return (get_presentation_chunks(normal_noun_chunks)[0:n],
            get_presentation_chunks(proper_noun_chunks)[0:n])


def replace_unicode_character(text):
    for char, repl, in _UNICODE_REPLACEMENTS.iteritems():
        text = text.replace(char, repl)
    return text

