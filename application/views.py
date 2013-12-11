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
import json

from hashlib import sha512
from collections import defaultdict
from datetime import datetime


from flask import request, session, render_template, redirect, url_for, jsonify, Response
from flask_cache import Cache
from flask.ext.login import current_user, login_user, logout_user, login_required
from flask.ext.oauth import OAuth
from pattern.web import Yahoo
from google.appengine.api import memcache, channel, taskqueue, urlfetch


from settings import FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, YAHOO_CONSUMER_KEY, YAHOO_CONSUMER_SECRET
from application import app

from .diffsync import SyncSession
from .models import User, Document, Link, PasswordToken, SharingToken, DocAccess, DeltaLog
from .forms import LoginForm, SignupForm
from .decorators import limit_free_plans, root_required
from .email_templates import send_mail_tpl

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
    send_mail_tpl('resetpw', user.email, dict(url=base_url, token=token))
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

def note(doc_id):
    doc = Document.get_by_id(doc_id)
    if doc and not doc.grant(current_user):
        doc = None
    return render_template('index.html', doc=doc)


@login_required
def profile():
    user = current_user
    if request.method == 'POST':
        #for now, only User.name can be changed via that endpoint
        payload = request.json or {}
        user.name = payload.get('name', user.name)
        if payload.get('limbo', '') == "!":
            user.custom_css = ".canvas .page .content textarea { font-family: Inconsolata; font-size: 11px; font-weight: bold;}"
        user.put()
    return jsonify(user.to_dict())


    

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
    for da in DocAccess.query(DocAccess.user == current_user.key).order(-DocAccess.last_change_at):
        doc = da.doc.get()
        is_shared = DocAccess.query(DocAccess.doc == da.doc).count() > 1
        last_da = DocAccess.query(DocAccess.doc == da.doc).order(-DocAccess.last_change_at).get()
        docs[group_key(doc.to_dict())].append({ 
            "id": doc.key.id(),
            "title": doc.title,
            "status": da.status,
            "role": da.role,
            "created": time.mktime(da.created_at.timetuple()),
            "updated": time.mktime(da.last_change_at.timetuple()),
            "shared": is_shared,
            "unseen": last_da.last_change_at > da.last_access_at,
            "last_doc_update": {
                "updated": time.mktime(last_da.last_change_at.timetuple()),
                "name": last_da.user.get().name if last_da.user else None,
                "email": last_da.user.get().email if last_da.user else last_da.email,
                }
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

    da, _ = DocAccess.create(doc, user=current_user, role='owner', status='active') 
    sess = da.create_session()
    resp = jsonify(doc_id=doc_id.id())
    resp.status = '201'
    resp.headers['Collab-Session-ID'] = sess['session_id']
    resp.headers['Channel-ID'] = channel.create_channel(sess['session_id'])
    return resp


@login_required
def edit_document(doc_id):
    data = request.json
    if not data:
        return "empty payload", 400
    doc = Document.get_by_id(doc_id)
    if not doc:
        return "document not found", 404
    access = doc.grant(current_user)
    if not access:
        return "access denied, sorry.", 403

    doc.title = data.get('title', doc.title)
    #TODO save status in DocAccess instance, not Document itself
    doc.status = data.get('status', doc.status)
    #doc.text = data.get('text', doc.text)
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
    access = doc.grant(current_user, request.headers.get("accesstoken"))
    if not access:
        return "access denied, sorry.", 403
    access.tick_seen()

    sess = access.create_session()
    resp = jsonify(doc.api_dict())
    resp.headers['Collab-Session-ID'] = sess['session_id']
    resp.headers['Channel-ID'] = channel.create_channel(sess['session_id'])
    return resp


@login_required
def doc_collaborators(doc_id):
    doc = Document.get_by_id(doc_id)
    if not doc:
        return "document not found", 404
    access = doc.grant(current_user)
    if not access:
        return "access denied, sorry.", 403

    if request.method == 'POST':
        if not request.json:
            return 'payload missing', 400
        pk = request.json.get('access_id')
        email = request.json.get('email')
        if pk and request.json.get('_delete'):
            # revoke doc-access
            da = DocAccess.get_by_id(pk)
            if da and da.doc == doc.key and da.role != 'owner':
                da.key.delete()
                return "ok"
            else:
                return "document not found or insufficient right", 404
        elif email:
            return doc.invite(email, current_user)
        else:
            return "", 400
    else: # GET 
        collabs = DocAccess.query(DocAccess.doc == doc.key).order(DocAccess.role, DocAccess.status)
        res = [{"access_id": x.key.id(),
                "role": x.role,
                "status": x.status,
                "user_id": x.user and x.user.id() or None,
                "email": x.user and x.user.get().email or x.email,
                "name": x.user and x.user.get().name or None,
                } for x in collabs]
        return Response(json.dumps(res, indent=4), mimetype="application/json")


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

def verify_links():  
    results = []
    if not request.json:
        return 'payload missing', 400
    if 'links' in request.json:
        links = request.json['links']
        for url in links:
            link = fetch_link(url)
            results.append(link);   
    else:
        return 'No links provided', 400     
    return jsonify(links=results)   

def fetch_link(url):
    # Fetch link via appengine fetch service
    # TODO: Retry with http/https if missing and add Beautiful soup (or similar lib)
    link = {"url" : url}
    result = urlfetch.fetch(url, allow_truncated=True, deadline=20)
    if result.status_code == 200:
        link['title'] = "Beautiful Soup coming soon"
        link['description'] = "Wohaaa" 
        link['verifying'] = False       
    return link       

@login_required
def sync_doc(doc_id):
    doc = Document.get_by_id(doc_id)
    if not doc:
        return "document not found", 404
    access = doc.grant(current_user)
    if not access:
        return "access denied, sorry.", 403

    cache = memcache.Client()
    sess_id = request.json.get('session_id')
    deltas = request.json.get('deltas', [])
    cache_key = "doc:{0}".format(doc_id)
    
    retries = 5
    while retries > 0:
        retries -= 1
        sess = SyncSession.fetch(sess_id, cache)
        if not sess:
            # session expired r not found, create new and request re-init on client side
            # TODO refactor and DRY out the whole sess-create and populate headers flow
            sess = access.create_session()
            resp = jsonify(doc.api_dict())
            resp.status = "412"
            resp.headers['Collab-Session-ID'] = sess['session_id']
            resp.headers['Channel-ID'] = channel.create_channel(sess['session_id'])
            access.tick_seen() 
            return resp
        elif not sess['user_id'] == current_user.key.id():
            return "not your sync session {0} != {1}".format(sess['user_id'], current_user.key.id()), 403

        if not cache.get(cache_key):
            # make sure mastertext is in cache for later CAS retrieval
            cache.set(cache_key, {'text': doc.text})
        cached_doc = cache.gets(cache_key)
        # N.B.: cached_doc will be modified inplace
        changed = sess.sync_inbound(deltas, cached_doc)
        if changed:
            ok = cache.cas(cache_key, cached_doc) 
            if ok:
                sess.save()
                taskqueue.add(payload="{0}-{1}".format(doc_id, sess_id), url='/_hro/notify_sessions')
                # persist changes in datastore; fire and forget...
                doc.text = cached_doc['text']
                doc.put_async()
                access.last_change_at = datetime.now()
                for d in deltas:
                    access.deltalog.insert(0, DeltaLog(delta=d['delta'], timestamp=access.last_change_at))
            else:
                # CAS timestamp expired, try all over again
                continue
        else:
            # master doc not changed, only persist session
            sess.save()

        access.tick_seen() 
        return jsonify(session_id=sess_id, deltas=sess['edit_stack'])
    return jsonify_err(400, "could not acquire lock for masterdoc")


def notify_sessions():
    doc_id, sess_id = request.data.split('-', 1)
    doc = Document.get_by_id(doc_id)
    sess = SyncSession.fetch(sess_id)
    if not doc or not sess or not sess['user_id']:
        #something went wrong...
        return
    user = User.get_by_id(sess['user_id'])
    msg = {"kind": "edit", 
           "doc_id": doc.key.id(), 
           "origin": {
               "session_id": sess['session_id'],
               "email": user.email,
               "name": user.name
               }
           }
    print "COLLABS"
    #collabs = [c.user.get() for c in DocAccess.query(DocAccess.doc == doc.key)]
    for da in DocAccess.query(DocAccess.doc == doc.key):
        if da.user:
            print "USER", da.user
            u = da.user.get()
            print "NOTIFY"
            u.push_message(msg)
    return "ok"


def create_missing_accessobjs():
    for doc in Document.query():
        if not DocAccess.query(DocAccess.doc == doc.key, DocAccess.role == 'owner', DocAccess.user == doc.owner).get():
            DocAccess.create(doc, user=doc.owner.get(), role='owner', status='active')
        for u in doc.shared_with:
            if not DocAccess.query(DocAccess.doc == doc.key, DocAccess.role == 'collab', DocAccess.user == u).get():
                DocAccess.create(doc, user=u.get(), role='collab', status='active')
    for st in SharingToken.query():
        da, _ = DocAccess.create(st.doc, email=st.email, role='collab', status='invited')
        da.token_hash = st.key.id()
        da.put()
    return 'ok'




def warmup():
    """App Engine warmup handler

    See http://code.google.com/appengine/docs/python/config/appconfig.html#Warming_Requests

    """
    return ''
