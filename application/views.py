"""
views.py

URL route handlers

Note that any handler params must match the URL route params.
For example the *say_hello* handler, handling the URL route '/hello/<username>',
  must be passed *username* as the argument.

"""
import json
import time
import string
import random
import logging as log
from google.appengine.runtime.apiproxy_errors import CapabilityDisabledError
from google.appengine.ext import ndb

from flask import request, render_template, make_response

from flask_cache import Cache

from application import app
from models import Document


gen_key = lambda: ''.join(random.sample(string.lowercase*3+string.digits*3, 12))

# Flask-Cache (configured to use App Engine Memcache API)
cache = Cache(app)

def home():
    return render_template('index.html')

def landing():
    return render_template('landing.html')

def settings():
    return render_template('settings.html')

def list_documents():
    docs = {                                                                                 
        "level": 0,
        "active": [],
        "archived": []
    }

    for doc in  Document.query():
        docs['active'].append({ 
            "id": doc.key.id(),
            "title": doc.title,
            "created": time.mktime(doc.created_at.timetuple())
            })
    resp = make_response(json.dumps(docs, indent=2))
    resp.mimetype = 'application/json'
    return resp

def create_document():
    #TODO sanitize & validate payload
    data = request.json
    log.info(data)
    if not data:
        return "empty payload", 400
    if data.get('id'):
        # todo: check ownership
        doc = Document.get_by_id(data['id'])
    else:
        doc = Document(key=ndb.Key(Document, gen_key()))
    doc.title = data['title'] 
    doc.text = data['text']
    doc.cursor = data['cursor']
    doc.hidecontext = data['hidecontext']

    doc_id = doc.put()
    return str(doc_id.id()), 201

def edit_document(doc_id):
    data = request.json
    if not data:
        return "empty payload", 400
    doc = Document.get_by_id(doc_id)
    if not doc:
        return "document not found", 404
    doc.title = data['title'] 
    doc.text = data['text']
    doc.cursor = data['cursor']
    doc.hidecontext = data['hidecontext']
    doc.put()
    return "", 204

def get_document(doc_id):
    doc = Document.get_by_id(doc_id)
    resp = make_response(doc.to_json())
    resp.mimetype = 'application/json'
    return resp



def warmup():
    """App Engine warmup handler
    See http://code.google.com/appengine/docs/python/config/appconfig.html#Warming_Requests

    """
    return ''

