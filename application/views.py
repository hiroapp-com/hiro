"""
views.py

URL route handlers

Note that any handler params must match the URL route params.
For example the *say_hello* handler, handling the URL route '/hello/<username>',
  must be passed *username* as the argument.

"""
import time
import string
import random
import uuid
import logging as log
from datetime import datetime

from google.appengine.ext import ndb

from flask import request, session, render_template, redirect, url_for, jsonify
from flask_cache import Cache
from flask.ext.login import current_user, login_user, logout_user, login_required
from flask.ext.oauth import OAuth
from pattern.en import tag
from pattern.web import Yahoo

from textmodels.textrank import get_top_keywords_list

from settings import FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, YAHOO_CONSUMER_KEY, YAHOO_CONSUMER_SECRET
from utils import create_query_string, get_search_term_list, wrap_term
from application import app
from models import User, Document, Link
from forms import LoginForm, SignupForm

yahoo = Yahoo(license=(YAHOO_CONSUMER_KEY, YAHOO_CONSUMER_SECRET))

gen_key = lambda: ''.join(random.sample(string.lowercase*3+string.digits*3, 12))


# Flask-Cache (configured to use App Engine Memcache API)
cache = Cache(app)

oauth = OAuth()
facebook = oauth.remote_app('facebook',
        base_url='https://graph.facebook.com/',
        request_token_url=None,
        access_token_url='/oauth/access_token',
        authorize_url='https://www.facebook.com/dialog/oauth',
        consumer_key=FACEBOOK_APP_ID,
        consumer_secret=FACEBOOK_APP_SECRET,
        request_token_params={'scope': 'email'}
)
facebook.tokengetter(lambda: session.get('oauth_token'))

def logout():
    logout_user()
    return '', 204


def fb_connect():
    return facebook.authorize(callback=url_for('fb_callback',
                              next=request.args.get('next') or request.referrer or None,
                              _external=True))
    

def fb_callback():
    """ Verify fb-auth response (initiated by wonderpad or /connect/facebook flow"""
    if request.method == 'POST':
        # request by own JS-code, communicating JS-SDK login to backend
        auth_resp = request.json
        access_token, check_userid = auth_resp['accessToken'], auth_resp.get('userID')
    elif request.method == 'GET':
        # request was initiaed by popup flow, auth request via /connect/facebook
        auth_resp = facebook.authorized_handler(lambda resp: resp)()
        access_token, check_userid = auth_resp['access_token'], None

    session['oauth_token'] = (access_token, '')
    me = facebook.get('/me')
    if me.headers['status'] != '200' or (check_userid and me.data.get('id') != check_userid):
        del session['oauth_token'] 
        resp = jsonify(errors=["Invalid access token"])
        resp.status = "401"
        return resp

    # generally imply that user has granted email-scope
    # and base database search on email 
    user = User.query(User.email == me.data['email']).get()
    if user is None:
        user = User(email=me.data['email'],
                    facebook_uid=me.data['id'],
                    token=uuid.uuid4().hex)
        user.put()
    elif not user.facebook_uid:
        user.facebook_uid = me.data['id']
        user.put()
    login_user(user, remember=True)
    return {'GET': redirect(request.args.get('next', '/')),
            'POST': jsonify(user.to_dict())
            }[request.method]


def login():
    form = LoginForm(csrf_enabled=False)
    if form.validate_on_submit():
        # form-validation already checked whether given email is registered
        user = User.query(User.email == form.email.data).get()
        if user.check_password(form.password.data):
            if login_user(user, remember=True):
                # logged in; returning userinfo
                return jsonify(user.to_dict())
            else:
                return "Could not login. Maybe account was suspended?", 401
        else:
            resp = jsonify(password=["Wrong Password"])
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
                return jsonify(user.to_dict())
            else:
                resp = jsonify(email=["E-Mail already registered"])
                resp.status = "401"
                return resp
        user = User()
        user.token = uuid.uuid4().hex
        user.email = form.email.data
        user.password = User.hash_password(form.password.data)
        user.put()
        login_user(user)
        resp = jsonify(user.to_dict())
        resp.status = "201" # Created
        return resp
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

@login_required
def list_documents():
    docs = {                                                                                 
        "level": 0,
        "active": [],
        "archived": []
    }

    for doc in  Document.query(Document.owner == current_user.key).order(-Document.updated_at):
        docs['active'].append({ 
            "id": doc.key.id(),
            "title": doc.title,
            "created": time.mktime(doc.created_at.timetuple()),
            "updated": time.mktime(doc.updated_at.timetuple())
            })
    return jsonify(docs)


@login_required
def create_document():
    #TODO sanitize & validate payload
    data = request.json
    if not data:
        return "empty payload", 400
    doc = Document(id=gen_key(), owner=current_user.key)
    timestamp = data.get('created')
    if timestamp is not None:
        doc.created_at = datetime.fromtimestamp(timestamp)
    doc.title = data.get('title') 
    doc.text = data.get('text', '')
    doc.cursor = data.get('cursor', 0)
    doc.hidecontext = data.get('hidecontext', False)

    links = data.get('links', {})
    doc.cached_ser = [Link(url=d['url'], title=d['title'], description=d['description'])  for d in links.get('normal', [])]
    doc.sticky = [Link(url=d['url'], title=d['title'], description=d['description'])  for d in links.get('sticky', [])]
    doc.blacklist = [Link(url=url)  for url in links.get('blacklist', [])]
    doc_id = doc.put()
    return str(doc_id.id()), 201


@login_required
def edit_document(doc_id):
    data = request.json
    if not data:
        return "empty payload", 400
    doc = Document.get_by_id(doc_id)
    if not doc:
        return "document not found", 404
    elif not doc.allow_access(current_user):
        return "access denied, sorry.", 403

    doc.title = data['title'] 
    doc.text = data['text']
    doc.cursor = data['cursor']
    doc.hidecontext = data['hidecontext']
    links = data.get('links', {})
    doc.cached_ser = [Link(url=d['url'], title=d['title'], description=d['description'])  for d in links.get('normal', [])]
    doc.sticky = [Link(url=d['url'], title=d['title'], description=d['description'])  for d in links.get('sticky', [])]
    doc.blacklist = [Link(url=url)  for url in links.get('blacklist', [])]
    doc.put()
    return "", 204

@login_required
def get_document(doc_id):
    doc = Document.get_by_id(doc_id)
    if not doc:
        return "document not found", 404
    elif not doc.allow_access(current_user):
        return "access denied, sorry.", 403
    return jsonify(doc.to_dict())


# old code copypasta follows

#@app.route('/analyze', methods=['POST'])
def analyze_content():
    text = request.form['content']
    textrank_chunks = get_top_keywords_list(text, 8)
    return jsonify(textrank_chunks=textrank_chunks)

#@app.route('/relevant', methods=['POST'])
def search_results():
    terms = request.form.getlist('search_terms')
    stripped_terms = ''.join(terms).strip()
    search_terms = get_search_term_list(stripped_terms)
                
    use_shortening = request.form.get('use_shortening') == 'true'
                
    keyword_count = len(search_terms)
    result_urls = {}
    result_list = []
                
    if use_shortening:
        while keyword_count >= 1 and len(result_list) < 20:
            current_search_terms = search_terms[:keyword_count]
            #log('Searching with query: %s' % ' '.join(
                #map(wrap_term, current_search_terms)))
            query_string = create_query_string(current_search_terms)
            results = yahoo.search(query_string, count=20)
                
            #log('Yahoo search with %d keywords resulted in %d urls...' % \
                    #(keyword_count, len(results)))
                
            # check for dupes
            for result in results:
                if result.url not in result_urls:
                    result_urls[result.url] = result
                    result_list.append(result)
            
            keyword_count = keyword_count - 2
            
    else:   
        #log('Searching with query: %s' % ' '.join(
            #map(wrap_term, search_terms)))
        query_string = create_query_string(search_terms)
        result_list = yahoo.search(query_string, count=20)
            
    #log('Yahoo search resulted in %d urls...' % (len(result_list)))
    return jsonify(results=result_list)





def warmup():
    """App Engine warmup handler
    See http://code.google.com/appengine/docs/python/config/appconfig.html#Warming_Requests

    """
    return ''

