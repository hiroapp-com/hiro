# This script computes idfs for the specified wikipa dump 
import page_parser
import json
import math
import sys

# Accumulation variables 
document_token_frequencies = {}
document_count = 0.0

# Input and output paths
WIKIPEDIA_DUMP_PATH = '/Users/ole/Development/Data/enwiki-20121001-pages-articles.xml'
IDT_JSON_PATH = 'idt.json'
MAX_DOCUMENT_COUNT = 10000

def finalize_data():	
	global document_count
	global document_token_frequencies

	# Compute token
	for key in document_token_frequencies.keys():
		document_token_frequencies[key] = math.log(document_count / document_token_frequencies[key])

	# Write idfs to output file
	json_string = json.dumps(document_token_frequencies)
	json_file = open(IDT_JSON_PATH, 'w')
	json_file.write(json_string + "\n")
	json_file.close()
	

# Callback for wikipedia page processing
def pageCallback(page):
	global document_count
	global document_token_frequencies

	# One more document
	document_count = document_count + 1.0

	# Get tokens of document text
	page_tokens = page.tokens()
	for token in page_tokens:
		token = token.lower()
		if document_token_frequencies.has_key(token):
			document_token_frequencies[token] = document_token_frequencies[token] + 1.0
		else:
			document_token_frequencies[token] = 1.0

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
