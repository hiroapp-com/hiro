# -*- coding: utf-8 -*-
"""
views.py

URL route handlers

Note that any handler params must match the URL route params.
For example the *say_hello* handler, handling the URL route '/hello/<username>',
  must be passed *username* as the argument.

"""
import os
import time
import string
import random
import uuid

from hashlib import sha512
from collections import defaultdict
from datetime import datetime


from flask import request, session, render_template, redirect, url_for, jsonify
from flask_cache import Cache
from flask.ext.login import current_user, login_user, logout_user, login_required
from flask.ext.oauth import OAuth
from pattern.web import Yahoo
from google.appengine.api import memcache, mail


from settings import FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, YAHOO_CONSUMER_KEY, YAHOO_CONSUMER_SECRET
from application import app

from .models import User, Document, Link, PasswordToken
from .forms import LoginForm, SignupForm
from .decorators import limit_free_plans, root_required

base_url = 'http://localhost:8080/' if 'Development' in os.environ['SERVER_SOFTWARE'] else 'https://alpha.hiroapp.com/'


yahoo = Yahoo(license=(YAHOO_CONSUMER_KEY, YAHOO_CONSUMER_SECRET))
def search_yahoo(terms, num_results=20):
    quoter = lambda s: u'"{0}"'.format(s) if ' ' in s else s
    qry = u'+'.join(quoter(t) for t in terms)
    cache_key = u'yahoo:{0}'.format(qry)
    result = memcache.get(cache_key)
    if result is None:
        result = [{'url': link.url,
                   'title': link.title,
                   'description': link.text} for link in yahoo.search(qry, count=num_results)]
        memcache.add(cache_key, result, time=60*60*3) # cache results for 3hrs max

    return result

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

def jsonify_err(status, *args):
    resp = jsonify(errors=args)
    resp.status = str(status)
    return resp

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

def reset_password(token):
    payload = request.json or {}
    if not payload.get('password'):
        return jsonify_err(400, 'password required')
    token = PasswordToken.get_by_id(sha512(token).hexdigest())
    if not token:
        return jsonify_err(404, 'Token not found')
    user = token.user.get()
    user.password = User.hash_password(payload['password'])
    user.put()
    token.key.delete()
    if login_user(user):
        return jsonify(user.to_dict())
    else:
        return "Could not login. Maybe account was suspended?", 401

#@root_required
def create_token():
    email = request.form.get('email')
    if not email:
        return "Email required", 400
    user = User.query(User.email == email).get()
    if not user:
        return 'Email not registered', 404
    token = PasswordToken.create_for(user)
    mail.send_mail(sender="Team Hiro <hello@hiroapp.com>", 
                   to=user.email,
                   subject="Resetting your Hiro password",
                   body="Hi,\n\njust visit {url}#reset={token} to reset your password.\n\nPlease let us know if there is anything else we can do,\n\nkeep capturing the good stuff.\n\nThe Hiro Team".format(url=base_url, token=token))
    return "Reset-Link sent."


@login_required
def change_plan():
    payload = request.json or {}
    plan, token = payload.get('plan'), payload.get('stripeToken')
    if not plan: 
        return jsonify_err(400, 'plan field required')
    ok, err = current_user.change_plan(plan, token)
    if not ok:
        return jsonify_err(400, err)
    return jsonify(current_user.to_dict())


def home():
    return render_template('index.html')

def landing():
    return render_template('landing.html')

def settings():
    return render_template('settings.html')

def test():
    return render_template('test.html')    

@login_required
def list_documents():
    group_by = request.args.get('group_by')
    if group_by is None or group_by not in ('status', ):
        #default
        group_key = lambda d: 'documents' 
    else:
        group_key = lambda d: d.get(group_by)

    docs = defaultdict(list)
    for doc in  Document.query(Document.owner == current_user.key).order(-Document.updated_at):
        docs[group_key(doc.to_dict())].append({ 
            "id": doc.key.id(),
            "title": doc.title,
            "status": doc.status,
            "created": time.mktime(doc.created_at.timetuple()),
            "updated": time.mktime(doc.updated_at.timetuple())
            })
    # Add current app.yaml version here, so the client knows the latest server version even if tab isn't closed for days/weeks    
    docs['hiroversion'] = os.environ['CURRENT_VERSION_ID'].split('.')[0];    
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

    doc.title = data.get('title', doc.title)
    doc.status = data.get('status', doc.status)
    doc.text = data.get('text', doc.text)
    doc.cursor = data.get('cursor', doc.cursor)
    doc.hidecontext = data.get('hidecontext', doc.hidecontext)
    links = data.get('links', {})
    if links.get('normal') is not None:
        doc.cached_ser = [Link(url=d['url'], title=d['title'], description=d['description'])  for d in links.get('normal', [])]
    if links.get('sticky') is not None:
        doc.sticky = [Link(url=d['url'], title=d['title'], description=d['description'])  for d in links.get('sticky', [])]
    if links.get('blacklist') is not None:
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
    return jsonify(doc.api_dict())

def analyze_content():
    tmpdoc = Document(text=request.form.get('content', ''))
    return jsonify(tmpdoc.analyze())

@limit_free_plans
def relevant_links():
    urls_seen, results = {}, []
    if not request.json:
        return 'payload missing', 400
    shorten = request.json.get('use_shortening', True)

    if 'text' in request.json:
        terms = request.json['text'].strip().split(' ', 2)
        if len(terms) > 2:
            terms = Document(text=request.json['text']).analyze()['textrank_chunks']

    elif 'terms' in request.json:
        terms = request.json['terms']
    else:
        return '"text"(str) or "terms"(array) property mandatory, neither provided.', 400

    if shorten:
        while len(terms) > 0 and len(results) < 20:
            serp = search_yahoo(terms) 
            for result in serp:
                if result['url'] not in urls_seen:
                    urls_seen[result['url']] = True
                    results.append(result)
            terms = terms[:-2]
    else:
        results = search_yahoo(terms)
    return jsonify(results=results)



def warmup():
    """App Engine warmup handler
    See http://code.google.com/appengine/docs/python/config/appconfig.html#Warming_Requests

    """
    return ''
