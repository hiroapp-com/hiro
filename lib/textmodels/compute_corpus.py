# This script computes idfs for the specified wikipa dump 
import page_parser
import json
import math
import sys

from pattern.vector import Document, Corpus

# Input and output paths
WIKIPEDIA_DUMP_PATH = '/Users/ole/Development/Data/enwiki-20121001-pages-articles.xml'
MAX_DOCUMENT_COUNT = 1000

documents = []

# Callback for wikipedia page processing
def pageCallback(page):
    global documents

	# One mor document
	document_count = document_count + 1.0

    d = Document(page.text)
    documents.append(d)

	# Do some feedback to the console
	if document_count % 1000 == 0:
		print 'document_count = %d' % document_count
		
	if document_count > MAX_DOCUMENT_COUNT:
		finalize_data()
		sys.exit("Document maximum reached...")		

# Parse the whole dump using the page processing callback method
page_parser.parseWithCallback(WIKIPEDIA_DUMP_PATH, pageCallback)

print 'tokens = %d' % len(document_token_frequencies.keys())

finalize_data()
