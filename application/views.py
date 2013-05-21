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
import uuid
import logging as log
from datetime import datetime

#from google.appengine.runtime.apiproxy_errors import CapabilityDisabledError
from google.appengine.ext import ndb

from flask import request, session, render_template, redirect, url_for, jsonify
from flask_cache import Cache
from flask.ext.login import login_user, logout_user, current_user

from application import app
from models import User, Document
from forms import LoginForm, SignupForm


gen_key = lambda: ''.join(random.sample(string.lowercase*3+string.digits*3, 12))

# Flask-Cache (configured to use App Engine Memcache API)
cache = Cache(app)


def logout():
    logout_user()
    return '', 204

    
def login():
    form = LoginForm(csrf_enabled=False)
    if form.validate_on_submit():
        # form-validation already checked whether given email is registered
        user = User.query(User.email == form.email.data).get()
        if user.check_password(form.password.data):
            if login_user(user, remember=True):
                return '', 204 # No Content
            else:
                return "Could not login. Maybe account was suspended?", 401
        else:
            resp = jsonify(password="Wrong Password")
            resp.status = "401"
            return resp
    else:
        resp = jsonify(form.errors)
        resp.status = "401"
        return resp

def register():
    form = SignupForm(csrf_enabled=False)
    if form.validate_on_submit():
        user = User.query(User.email == form.email.data).get()
        if user is not None:
            if user.check_password(form.password.data):
                login_user(user, remember=True)
                return '', 204 # No Content
            else:
                resp = jsonify(email="E-Mail already in registered")
                resp.status = "401"
                return resp
        user = User()
        user.token = uuid.uuid4().hex
        user.email = form.email.data
        user.password = User.hash_password(form.password.data)
        user.put()
        login_user(user)
        return '', 201 # Created
    else:
        resp = jsonify(form.errors)
        resp.status = "401"
        return resp


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

    for doc in  Document.query().order(-Document.updated_at):
        docs['active'].append({ 
            "id": doc.key.id(),
            "title": doc.title,
            "created": time.mktime(doc.created_at.timetuple()),
            "updated": time.mktime(doc.updated_at.timetuple())
            })
    return jsonify(docs)

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
    timestamp = data.get('created')
    if timestamp is not None:
        doc.created_at = datetime.fromtimestamp(timestamp)
    doc.title = data.get('title', 'Untitled') 
    doc.text = data.get('text', '')
    doc.cursor = data.get('cursor', 0)
    doc.hidecontext = data.get('hidecontext', False)
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
    return jsonify(doc.to_dict())



def warmup():
    """App Engine warmup handler
    See http://code.google.com/appengine/docs/python/config/appconfig.html#Warming_Requests

    """
    return ''

