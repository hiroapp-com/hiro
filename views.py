# -*- coding: utf-8 -*-
"""
views.py

URL route handlers

Note that any handler params must match the URL route params.
For example the *say_hello* handler, handling the URL route '/hello/<username>',
  must be passed *username* as the argument.

"""
from flask import request, session, render_template, jsonify, Response, redirect, url_for
from flask.ext.oauth import OAuth

from settings import FACEBOOK_APP_ID, FACEBOOK_APP_SECRET

from models import User, Session

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

def home():
    # TODO(flo) inject that no manifest is loaded if we're in the dev environment    
    return render_template('hync_home.html')  

def anon():
    return jsonify(token=User.anon_token())

def login():
    data  = request.json
    sid = data.get('sid')
    pwd = data.get('password')
    if not pwd:
        return jsonify_err(400, password="password required")

    user = User(email=data.get('email'), phone=data.get('phone'))
    if not user.pwlogin(pwd):
        return jsonify_err(400, password="email/phone or password incorrect")
    sess = Session.load(sid) if sid else None
    if sess:
        user.copy_noterefs_from(sess.user)
    # TODO: delete old user/session?
    return jsonify(token=user.token('login'))

def register():
    data  = request.json
    sid = data.get('sid')
    name = data.get('name', '')
    email = valid_email(data.get('email', ''))
    phone = data.get('phone', '')
    pwd = data.get('password')
    if email == phone == '':
        return jsonify_err(403, email='email or phone required')
    if passwd_check(pwd) is not None:
        return jsonify_err(400, password=passwd_check(pwd))

    sess = Session.load(sid) if sid else None
    # if no sid: create new user and return new logintoken. 
    # sends verify emails/texts if no password provided
    if not sess:
        return register_blank(name, email, phone, pwd)

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
    return jsonify(token=sess.user.token('login'))

def register_blank(name, email, phone, pwd):
    user = User.create(name=name, email=email, phone=phone, pwd=pwd)
    if user is None:
        return jsonify_err(400, email="Email already registered")

    email_token, phone_token = user.token('verify-email'), user.token('verify-phone')
    if email_token:
        #TODO send email with verify token
        print "generated verify-email token: ", email_token
        if not pwd:
            # send email with "set your pwd" copy
            pass
        else:
            # send email with "verify your email" copy
            pass

    if phone_token:
        print "generated verify-email token: ", phone_token
        #TODO send email with verify token
    # give him a login token for his new user
    return jsonify(token=user.token('login'))

def change_plan():
    data = request.json or {}
    sid, plan, token = data.get('sid'), data.get('plan'), data.get('stripeToken')
    if not all(sid, plan, token):
        return jsonify_err(400, error='sid, plan and stripe-token required')
    sess = Session.load(sid)
    err = sess.user.change_plan(plan,token)
    if err:
        return jsonify_err(400, error=err)
    return jsonify(status="ok")

# Direct Templates
def landing():
    return render_template('hync_landing.html')  

def settings():
    return render_template('hync_settings.html')    

def offline():
    return render_template('hync_offline.html')     

def note():
    # TODO(flo) never include manifest in template requested via /note/<id> 
    return render_template('hync_home.html')  

def manifestwrapper():
    return render_template('hync_manifestwrapper.html')           

def test():
    return render_template('test.html')   

def static_manifest():
    return Response(render_template('hiro.appcache'), mimetype="text/cache-manifest")

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
    user = User.find_by_fb(me.data['id'])
    if user is None and me.data.get('email'):
        # let's try (verified) email
        user = User.find_by_email(me.data['email'])
    if user is None:
        # well, lets create new one!
        user = User.create(email=me.data.get('email', ''), fb_uid=me.data['id'])
        user.set_verified(email=user.email)
    elif not user.fb_uid:
        user.update(fb_uid=me.data['id'])
    return {'GET': redirect(request.args.get('next', '/')),
            'POST': jsonify(token=user.token('login'))
            }[request.method]



# helper functions
def valid_email(email):
    if u'@' not in unicode(email):
        return ""
    return email

def passwd_check(pwd):
    if pwd is None:
        return None
    if len(pwd) < 6:
        return "password to short (min 6chars)"
    return None

def jsonify_err(status, **kwargs):
    resp = jsonify(**kwargs)
    resp.status = str(status)
    return resp
