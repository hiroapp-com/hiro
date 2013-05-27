# -*- coding: utf-8 -*-

# Methods to determine most significant tokens in a text 

import json
import math
import re

# Path of idt file 
IDT_JSON_PATH = 'idt.json'

# Load idt dictionary
idt = json.loads(open(IDT_JSON_PATH).read())

class ScoredToken(object):
	def __init__(self):
		self.token = u''
		self.score = 0.0

def add_token_to_result_set(result_set, token):
	global idt
	if not result_set.has_key(token):
		token_object = ScoredToken()
		token_object.token = token

		if idt.has_key(token):
			token_object.score = idt[token]
		else:
			token_object.score = 1.0
	
		result_set[token] = token_object

def significant_tokens(text):
	global idt 

	re_ignore = re.compile('[\[\]\{\}\)\(\*\|\'\"<>!,:;]+')

	result_set = {}

	candidates = text.split()
	for candidate in candidates:
		if re_ignore.search(candidate)==None:
			candidate = candidate.lower()
			if candidate.endswith('.'):
				without_period = candidate[:-1]
				if idt.has_key(without_period):
					add_token_to_result_set(result_set, without_period)
					continue
			add_token_to_result_set(result_set, candidate)


	result_list = sorted(result_set.values(), key=lambda x: x.score, reverse=True) 

	return result_list

text = u"Days after the storm, many in the New York area were becoming exasperated as they tried to cope with widespread gas shortages, chilly homes without electricity and lines for buses and food handouts."

tokens = significant_tokens(text)

for token in tokens:
	print token.token + ' = ' + str(token.score)







