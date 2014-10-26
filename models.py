import sys
import uuid
import random
import string
import datetime
import calendar
import psycopg2
from hashlib import sha512

import stripe

from flask import g, current_app
from secret_keys import STRIPE_SECRET_KEY
from passlib.hash import pbkdf2_sha512
from jsonclient import JSONClient


COMM_ADDR = ("127.0.0.1", "7777")

comm_client = JSONClient(COMM_ADDR)
gen_uid = lambda: ''.join(random.sample(string.lowercase*3+string.digits*3, 8))

def get_db():
    return psycopg2.connect(current_app.config['DB_PATH'])

def send_email(kind, to_name, to_email, data):
    print "sending email", kind, to_name, to_email, data
    comm_client.call("WrapRPC.Send", 2, {"kind": kind,
                                         "rcpt": {"name": to_name,
                                             "addr": to_email,
                                             "kind": "email"
                                             },
                                         "data": data
                                         })
def send_sms(kind, to_name, to_phone, data):
    print "sending sms", kind, to_name, to_phone, data
    comm_client.call("WrapRPC.Send", 2, {"kind": kind,
                                         "rcpt": {"name": to_name,
                                             "addr": to_phone,
                                             "kind": "phone"
                                             },
                                         "data": data
                                         })

def gen_token():
    token = uuid.uuid4().hex
    key = sha512(token).hexdigest()
    return token, key

class User(object):
    PLANS = {'free': 1,
             'starter': 2,
             'pro': 3
             }
    PAID_PLANS = ('starter', 'pro')

    def __init__(self, uid=None, name='', tier=None, email='', phone='', fb_uid='', pwd=''):
        self.uid = uid
        self.tier = tier
        self.email = email
        self.phone = phone
        self.email_status = ''
        self.phone_status = ''
        self.fb_uid = fb_uid
        self.pwd = pwd

    @classmethod
    def load(cls, uid):
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""select name
                            , tier
                            , email
                            , email_status
                            , phone
                            , phone_status
                            , fb_uid
                            , password 
                       from users where uid = %s""", (uid,))
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        user = cls(uid, row[0], row[1], row[2], row[4], row[6], row[7])
        user.email_status = row[3]
        user.phone_status = row[5]
        return user


    @classmethod
    def create(cls, name='', email='', phone='', fb_uid='', pwd=None):
        conn = get_db()
        cur = conn.cursor()
        uid = gen_uid()
        passwd = pbkdf2_sha512.encrypt(pwd) if pwd else None
        user = User(uid=uid, tier=1, name=name, email=email, phone=phone, fb_uid=fb_uid, pwd=pwd)
        user.email_status = 'unverified' if email else ''
        user.phone_status = 'unverified' if phone else ''
        cur.execute("""INSERT INTO users 
                        (uid
                        , tier
                        , name
                        , email
                        , phone
                        , email_status
                        , phone_status
                        , fb_uid
                        , signup_at
                        , created_at
                        , password
                        ) 
                        VALUES (%s
                              , %s
                              , %s
                              , %s
                              , %s
                              , %s
                              , %s
                              , %s
                              , now()
                              , now()
                              , %s
                              )""", (uid, user.tier, name, email, phone, user.email_status, user.phone_status, fb_uid,  passwd))
        conn.commit()
        conn.close()
        return user

    @classmethod
    def find_by(cls, email="", phone="", fb_uid="", verified_only=False):
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""SELECT uid
                          FROM users 
                          WHERE tier > 0
                             AND (
                             (email <> '' AND email = %s) 
                             OR (phone <> '' AND phone = %s)
                             OR (fb_uid <> '' AND fb_uid = %s)
                             )""", (email, phone, fb_uid))
        row = cur.fetchone()
        conn.close()
        if not row:
            return None
        return User.load(row[0])

    def update(self, **kwds):
        if not kwds:
            return None
        conn = get_db()
        cur = conn.cursor()
        setter = []
        args = []
        for k, v in kwds.iteritems():
            setter.append(u' = '.join((k, '%s')))
            args.append(v)
        args.append(self.uid)
        cur.execute("UPDATE users SET {} WHERE uid = %s".format(u', '.join(setter)), tuple(args))
        conn.commit()
        conn.close()
        for k, v in kwds.iteritems():
            setattr(self, k, v)
        return True

    def check_pwd(self, pwd):
        if not self.pwd:
            return False
        return pbkdf2_sha512.verify(pwd, self.pwd)

    def signup(self, pwd):
        if not self.uid:
            return False
        conn = get_db()
        cur = conn.cursor()
        passwd = pbkdf2_sha512.encrypt(pwd) if pwd else None
        self.pwd = passwd
        cur.execute("UPDATE users SET tier = 1, password = %s, signup_at = now() WHERE uid = %s ", (passwd, self.uid))
        ok = bool(cur.rowcount)
        conn.close()
        if ok:
            self.tier = 1
        return ok

    def sms_post_signup(self):
        if not self.phone or not self.tier > 0:
            return False
        if self.phone_status == 'unverified':
            token = self.token('verify-phone')
            if self.pwd:
                send_sms("signup-verify", "", self.phone, dict(token=token))
            else:
                send_sms("signup-setpwd", "", self.phone, dict(token=token))
        elif self.phone_status == 'verified':
            token = self.token('login')
            if not self.pwd:
                send_sms("welcome-setpwd", "", self.phone, dict(token=token))
        else:
            return False
        return True

    def email_post_signup(self):
        if not self.email or not self.tier > 0:
            return False
        if self.email_status == 'unverified':
            token = self.token('verify-email')
            if self.pwd:
                send_email("signup-verify", "", self.email, dict(token=token))
            else:
                send_email("signup-setpwd", "", self.email, dict(token=token))
        elif self.email_status == 'verified':
            token = self.token('login')
            if not self.pwd:
                send_email("welcome-setpwd", "", self.email, dict(token=token))
        else:
            return False
        return True

    def sms_reset_pwd(self):
        if not self.phone:
            return
        token = self.token('verify-phone') if self.phone_status == 'unverified' else self.token('login')
        send_sms("reset-pwd", "", self.phone, dict(token=token))

    def email_reset_pwd(self):
        if not self.email:
            return
        token = self.token('verify-email') if self.email_status == 'unverified' else self.token('login')
        send_email("reset-pwd", "", self.email, dict(token=token))

    def sms_verify(self):
        if not self.phone or self.phone_status == 'verified':
            return
        token = self.token('verify-phone')
        send_sms("verify", "", self.phone, dict(token=token))

    def email_verify(self):
        if not self.email or self.email_status == 'verified':
            return
        token = self.token('verify-email')
        send_email("verify", "", self.email, dict(token=token))

    @staticmethod
    def anon_token():
        token, hashed = gen_token()
        conn = get_db()
        cur = conn.cursor()
        cur.execute("INSERT INTO tokens (token, kind) VALUES (%s, 'anon')", (hashed,))
        conn.commit()
        conn.close()
        return token

    def token(self, kind):
        if not self.uid:
            return None
        conn = get_db()
        cur = conn.cursor()
        token, hashed = gen_token()
        if kind == 'login':
            cur.execute("INSERT INTO tokens (token, kind, uid) VALUES (%s, 'login', %s)", (hashed, self.uid))
        elif kind == 'verify-email' and self.email:
            cur.execute("SELECT 1 FROM tokens WHERE kind = 'verify' AND email <> '' AND times_consumed = 0 AND uid = %s", (self.uid,))
            if cur.fetchone():
                cur.execute("UPDATE tokens SET token = %s, email = %s, valid_from = now() WHERE uid = %s AND email <> '' AND times_consumed = 0", (hashed, self.email, self.uid))
            else:
                cur.execute("INSERT INTO tokens (token, kind, uid, email) VALUES (%s, 'verify', %s, %s)", (hashed, self.uid, self.email))
        elif kind == 'verify-phone' and self.phone:
            cur.execute("SELECT 1 FROM tokens WHERE kind = 'verify' AND phone <> '' AND times_consumed = 0 AND uid = %s", (self.uid,))
            if cur.fetchone():
                cur.execute("UPDATE tokens SET token = %s, phone = %s, valid_from = now() WHERE uid = %s AND phone <> '' AND times_consumed = 0", (hashed, self.phone, self.uid))
            else:
                cur.execute("INSERT INTO tokens (token, kind, uid, phone) VALUES (%s, 'verify', %s, %s)", (hashed, self.uid, self.phone))
        else:
            token = None
        conn.commit()
        conn.close()
        return token

    def get_stripe_customer(self, token=None):
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT stripe_customer_id FROM users WHERE uid = %s", (self.uid,))
        row = cur.fetchone()
        if not row:
            conn.close()
            raise Exception("cannot fetch stripe customer, uid ({}) does not exist".format(self.uid))
        cust_id = row[0]
        stripe.api_key = STRIPE_SECRET_KEY
        if not cust_id:
            if token is None:
                conn.close()
                return None
            customer = stripe.Customer.create(
                    card=token,
                    email=self.email
                    )
            cur.execute("UPDATE users SET  stripe_customer_id = %s WHERE uid = %s", (customer.id, self.uid,))
            conn.commit()
            conn.close()
            return customer
        else:
            conn.close()
            return stripe.Customer.retrieve(cust_id)

    def change_plan(self, new_plan, token=None, force=False):
        if tokenhistory_seen(token):
            return "Replay attempt, token already used"
        elif new_plan not in User.PLANS:
            return "Trying to change to unknown plan, valid options: {0}".format(', '.join(User.PLANS.keys()))
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT tier FROM users WHERE uid = %s", (self.uid,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return "User with uid `{}` not found".format(self.uid)
        current_plan = dict(zip(User.PLANS.values(), User.PLANS.keys())).get(row[0])
        if current_plan == new_plan:
            # makes no sense, dude
            return "Cannot change to plan you already have"

        # communicate changes to stripe, if necessary
        stripe_customer = self.get_stripe_customer(token)
        if current_plan in User.PAID_PLANS and new_plan not in User.PAID_PLANS:
            # downgrade, cancel paid plan
            if stripe_customer:
                stripe_customer.cancel_subscription(at_period_end=True)
                # subscription will end by the end of the month, save how
                # it's still paid for and deactivate after expiration, see XXX
                # TODO: backgroundtask for expired plan cancelation
                now = datetime.datetime.now()
                last_day = calendar.monthrange(now.year, now.month)[1]
                expiry = now.replace(day=last_day, hour=23, minute=59)
                cur.execute("UPDATE users SET tier = %s, plan_expires_at = %s WHERE uid = %s", (User.PLANS[new_plan], expiry, self.uid,))
        else:
            # handles up-/downgrades between paid plans and paid_upgade from free
            if stripe_customer:
                # tell stripe about subscription change
                stripe_customer.update_subscription(plan=new_plan)
                if token:
                    tokenhistory_add(token, self.uid)
            elif not force:
                conn.close()
                return "Trying non-forced upgrade to paid plan without valid stripeToken"
            # make sure, previous plan-expirations are unset after upgrade
            cur.execute("UPDATE users SET tier = %s, plan_expires_at = '' WHERE uid = %s", (User.PLANS[new_plan], self.uid))
        conn.commit()
        conn.close()
        return None


class Session(object):
    def __init__(self, sid):
        self.sid = sid
        self.user = None

    @classmethod
    def load(cls, sid):
        conn = get_db()
        cur = conn.cursor()
        cur.execute("select uid from sessions where sid = %s", (sid,))
        row = cur.fetchone()
        if not row:
            return None
        sess = cls(sid)
        sess.user = User.load(row[0])
        conn.close()
        return sess

def tokenhistory_add(token, uid):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("INSERT INTO stripe_tokens (token, uid, seen_at) VALUES (%s, %s, now())", (token, uid))
    conn.commit()
    conn.close()

def tokenhistory_seen(token):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM stripe_tokens WHERE token = %s", (token,))
    row = cur.fetchone()
    conn.close()
    return bool(row)
