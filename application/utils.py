from urllib import quote
import re


def normalize(text):
    return u"''"


def wrap_term(search_term):
    if ' ' in search_term:
        return '"%s"' % search_term
    return search_term


def create_query_string(query_terms):
    wrapped_terms = map(wrap_term, query_terms)
    s = ' '.join(wrapped_terms)
    return quote(s.encode('utf-8'))


def get_search_term_list(a):
    scan_index = 0
    term_start = 0
    within_quote = False
    split_char = ' '
    terms = []

    while scan_index < len(a):
        if within_quote:
            if a[scan_index]=='"':
                terms.append(a[term_start:scan_index])
                term_start = scan_index + 1
                within_quote = False
        else:
            if a[scan_index]==' ':
                if term_start < scan_index:
                    terms.append(a[term_start:scan_index])
                    term_start = scan_index + 1
                    within_quote = False
            elif a[scan_index]=='"':
                term_start = scan_index + 1
                within_quote = True
        scan_index += 1

    if (term_start<len(a)):
        terms.append(a[term_start:len(a)])

    return filter(len, [re.sub(r'\s+', ' ', x.strip()) for x in terms])
