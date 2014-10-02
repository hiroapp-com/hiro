# -*- coding: utf-8 -*-
"""
views.py

URL route handlers

Note that any handler params must match the URL route params.
For example the *say_hello* handler, handling the URL route '/hello/<username>',
  must be passed *username* as the argument.

"""
from flask import current_app, request, session, render_template, jsonify, Response, redirect, url_for
from flask.ext.oauth import OAuth

from secret_keys import FACEBOOK_APP_ID, FACEBOOK_APP_SECRET

from models import User, Session
import subprocess

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

def version():
    git = getgit()
    return jsonify(version=git['version'], name=git['name']);

def home():
    return render_template('hync_home.html', want_manifest=(not current_app.config['DEBUG']), git=getgit())  

def crash():
    raise Exception("intended crash")
    return ''

def anon():
    return jsonify(token=User.anon_token())

def login():
    data  = request.json
    sid = data.get('sid')
    pwd = data.get('password')
    if not pwd:
        return jsonify_err(400, password="Password required")

    users = User.find_by(email=data.get('email'), phone=data.get('phone'))
    for user in users:
        if user.check_pwd(pwd):
            sess = Session.load(sid) if sid else None
            if sess:
                user.copy_noterefs_from(sess.user)
                user.steal_ownerships_from(sess.user)
            # TODO: delete old user/session?
            return jsonify(token=user.token('login'))
    return jsonify_err(400, password="Wrong password or not signed up yet?")

def register():
    data  = request.json
    sid = data.get('sid')
    name = data.get('name', '')
    email = valid_email(data.get('email', ''))
    phone = data.get('phone', '')
    pwd = data.get('password')
    if email == phone == '':
        return jsonify_err(403, email='Your Email or Phone #')
    if passwd_valid(pwd) is not None:
        return jsonify_err(400, password=passwd_valid(pwd))

    sess = Session.load(sid) if sid else None
    existing = User.find_by(email=email, phone=phone)
    if len(existing) > 0:
        for user in existing:
            if user.check_pwd(pwd):
                if sess:
                    user.copy_noterefs_from(sess.user)
                    user.steal_ownerships_from(sess.user)
                    # TODO: delete old user/session?
                return jsonify(token=user.token('login'))
        return jsonify_err(400, password="Wrong password")

    # if no sid: create new user and return new logintoken. 
    # sends verify emails/texts if no password provided
    if not sess:
        user = User.create(name=name, email=email, phone=phone, pwd=pwd)
        if user is None:
            # this should not not happen
            return jsonify_err(400, email="Email already registered")
        user.send_signup_token()
        return jsonify(token=user.token('login'))

    # we have a valid session, yay!
    if sess.user.tier > 0:
        # session is already authenticated, abort
        return jsonify_err(403, session='session already authenicated')
    if not sess.user.signup(email, phone, pwd):
        return jsonify_err(400, session='signup failed')
    # check if we can auto-verify email or phone (and thus, merge his files over)
    if sess.token_user:
        # token used by session was a sharing token, targeted at a specific user
        # check, if we can auto-verify some email or phone
        if email and email == sess.token_user.email:
            if sess.user.set_verified(email=email):
                sess.user.copy_noterefs_from(sess.token_user)
                #delete_user(sess.token_user.uid)
        if phone and phone == sess.token_user.phone:
            if sess.user.set_verified(phone=phone):
                sess.user.copy_noterefs_from(sess.token_user)
                #delete_user(sess.token_user.uid)
    # will only send tokens for email/phone if its status is still 'unverified' 
    # status could have been changed by set_verified(..) call
    sess.user.send_signup_token()
    return jsonify(token=sess.user.token('login'))

def change_plan():
    data = request.json or {}
    sid, plan, token = data.get('sid'), data.get('plan'), data.get('stripetoken')
    if not all([sid, plan, token]):
        return jsonify_err(400, error='Something went wrong on our side, please try again later.')
    sess = Session.load(sid)
    if not sess:
        return jsonify_err(403, error=sid)    
    err = sess.user.change_plan(plan,token)
    if err:
        return jsonify_err(400, error=err)
    return jsonify(status="ok")

# Direct Templates
def landing():
    return render_template('hync_landing.html')  

def settings():
    return render_template('hync_settings.html')       

def note(note_id):
    return render_template('hync_home.html', git=getgit()) 

def offline():
    return render_template('hync_home.html', git=getgit())       

def manifestwrapper():
    return render_template('hync_manifestwrapper.html')           

def test():
    return render_template('test.html')   

def static_manifest():
    resp =  Response(render_template('hiro.appcache'), mimetype="text/cache-manifest")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

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

    # first search user by fb id
    user = User.find_by(fb_uid=me.data['id'])
    user = user[0] if len(user) == 1 else None
    if not user and me.data.get('email'):
        # let's try (verified) email
        user = User.find_by(email=me.data['email'])
        user = user[0] if len(user) > 0 else None
    if not user:
        # well, lets create new one!
        user = User.create(email=me.data.get('email', ''), fb_uid=me.data['id'])
    elif not user.fb_uid:
        user.update(fb_uid=me.data['id'])
    user.set_verified(email=user.email)
    # TODO(flo) we need to somehow pass over the sid
    #           to the callback, so we can takeover session
    #           notes. do we want to send fb the raw sid?
    #           it will(should) be abandoned shortly anyway
    #sess = Session.load(sid) if sid else None
    #if sess:
    #    user.copy_noterefs_from(sess.user)
    #    user.steal_ownerships_from(sess.user)
    return {'GET': redirect(request.args.get('next', '/')),
            'POST': jsonify(token=user.token('login'))
            }[request.method]



# helper functions
def valid_email(email):
    if u'@' not in unicode(email):
        return ""
    return email

def passwd_valid(pwd):
    if pwd is None:
        return None
    if len(pwd) < 4:
        return "Too short (at least 4)"
    return None

def jsonify_err(status, **kwargs):
    resp = jsonify(**kwargs)
    resp.status_code = status
    return resp

# Fetch current git properties, not cached atm
def getgit():
    try:
        tag = subprocess.check_output(["git", "tag", "-l", "-n1"]).splitlines()[-1]
        version = '-'.join([tag.partition(' ')[0],subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD']).strip()])
        git = { 'name': tag[16:], 'version': version }
        return git
    except:
        return False    