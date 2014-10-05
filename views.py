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
    pwd, email, phone = request.json.get('password'), request.json.get('email'), request.json.get('phone')
    if not pwd:
        return jsonify_err(400, password="Password required")
    if not any((email, phone)) or all((email, phone)):
        return jsonify_err(400, password="Please enter your email or phone number")
    user = User.find_by(email=email, phone=phone)
    if user:
        if email and user.email_status != 'verified':
            return jsonify_err(400, password="Please verify your email first.")
        if phone and user.phone_status != 'verified':
            return jsonify_err(400, password="Please verify your phone number first.")
        if user.check_pwd(pwd):
            return jsonify(token=user.token('login'))
    return jsonify_err(400, password="Wrong password or not signed up yet?")

def register():
    data  = request.json
    sid = data.get('sid')
    name = data.get('name', '')
    email = valid_email(data.get('email', ''))
    phone = data.get('phone', '')
    pwd = data.get('password')
    if not any((email, phone)) or all((email, phone)):
        return jsonify_err(403, email='Either Email or Phone #')
    if passwd_valid(pwd) is not None:
        return jsonify_err(400, password=passwd_valid(pwd))

    # check if user is already registered
    user = User.find_by(email=email, phone=phone)
    if user:
        if user.check_pwd(pwd):
            return jsonify(token=user.token('login'))
        return jsonify_err(400, password="Wrong password")

    
    print "ping1"
    sess = Session.load(sid) if sid else None
    if sess and email and sess.user.email == email:
        print "ping2"
        # tier can only be 0 at this point, otherwise User.find_by would have 
        # found it already above
        if sess.user.signup(pwd) and sess.user.email_post_signup():
            print "ping3"
            return jsonify(token=sess.user.token('login'))
    elif sess and phone and sess.user.phone == phone:
        print "ping4"
        # tier can only be 0 at this point, otherwise User.find_by would have 
        # found it already above
        if not sess.user.signup(pwd) and sess.user.email_post_signup():
            print "ping5"
            return jsonify(token=sess.user.token('login'))
    else:
        print "ping6"
        user = User.create(name=name, email=email, phone=phone, pwd=pwd)
        if user is None:
            print "ping7"
            # this should not not happen
            return jsonify_err(400, email="Email already registered")
        if email:
            print 'ping888'
        if email and user.email_post_signup():
            print "ping8"
            return jsonify(token=user.token('login'))
        elif phone and  user.email_post_signup():
            print "ping9"
            return jsonify(token=user.token('login'))
    return jsonify_err(400, password="Something went wrong. Please try again")
         
def reset_pwd():
    email = valid_email(request.json.get('email', ''))
    phone = request.json.get('phone', '')
    if not any((email, phone)) or all((email, phone)):
        return jsonify_err(403, email='Either Email or Phone #')
    # check if user is already registered
    user = User.find_by(email=email, phone=phone)
    if user:
        user.email_reset_pwd()
        #user.txt_reset_pwd() #sms templates not implemented
    return jsonify(status="ok")

def verify():
    email = valid_email(request.json.get('email', ''))
    phone = request.json.get('phone', '')
    if not any((email, phone)) or all((email, phone)):
        return jsonify_err(403, email='Either Email or Phone #')
    # check if user is already registered
    user = User.find_by(email=email, phone=phone)
    if user:
        user.email_verify()
        #user.txt_verify() #sms templates not implemented
    return jsonify(status="ok")

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
    if not user and me.data.get('email'):
        # let's try (verified) email
        user = User.find_by(email=me.data['email'])
    if not user:
        # well, lets create new one!
        user = User.create(email=me.data.get('email', ''), fb_uid=me.data['id'])
    elif not user.fb_uid:
        user.update(fb_uid=me.data['id'])
    token = user.token('verify-email') if user.email_status =='unverified' else user.token('login')
    return {'GET': redirect(request.args.get('next', '/')),
            'POST': jsonify(token=token)
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
