import uuid
import random
import string
import datetime
import calendar
from hashlib import sha512

import stripe

from settings import STRIPE_SECRET_KEY
from hiro import get_db
from passlib.hash import pbkdf2_sha512
from jsonclient import JSONClient


COMM_ADDR = ("127.0.0.1", "7777")

comm_client = JSONClient(COMM_ADDR)
gen_uid = lambda: ''.join(random.sample(string.lowercase*3+string.digits*3, 8))

def send_email(kind, to_name, to_email, data):
    print "sending email", kind, to_name, to_email, data
    comm_client.call("WrapRPC.Send", 2, {"kind": kind,
                                         "rcpt": {"name": to_name,
                                             "addr": to_email,
                                             "kind": "email"
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
    def create(cls, name='', email='', phone='', fb_uid='', pwd=None):
        conn = get_db()
        uid = gen_uid()
        passwd = pbkdf2_sha512.encrypt(pwd) if pwd is not None else None
        user = None
        with conn:
            row = conn.execute("""SELECT uid, name, email, phone, fb_uid
                                FROM users 
                                WHERE (email = ? AND email <> '' AND email_status IN ('unverified', 'verified'))
                                    OR (phone = ? AND phone <> '' AND phone_status IN ('unverified', 'verified'))
                                    OR (fb_uid <> '' AND fb_uid = ?)
                               """, (email, phone, fb_uid)).fetchone()
            if row:
                return None
            user = User(uid=uid, name=name, email=email, phone=phone, fb_uid=fb_uid, pwd=pwd)
            user.email_status = 'unverified' if email else ''
            user.phone_status = 'unverified' if phone else ''
            conn.execute("""INSERT INTO users 
                            (uid
                            , name
                            , email
                            , phone
                            , tier
                            , email_status
                            , phone_status
                            , fb_uid
                            , signup_at
                            , created_at
                            , password
                            ) 
                            VALUES (?
                                  , ?
                                  , ?
                                  , ?
                                  , 1
                                  , ?
                                  , ?
                                  , ?
                                  , datetime('now')
                                  , datetime('now')
                                  , ?
                                  )""", (uid, name, email, phone, user.email_status, user.phone_status, fb_uid,  passwd))
        conn.commit()
        return user

    @classmethod
    def find_by(cls, email="", phone="", fb_uid="", verified_only=False):
        conn = get_db()
        rows = conn.execute("""SELECT uid
                                    , email
                                    , email_status
                                    , phone
                                    , phone_status
                                    , fb_uid
                                    , password 
                                FROM users 
                                WHERE (email = ? and email_status IN ('verified', 'unverified')) 
                                   OR (phone = ? and phone_status IN ('verified', 'unverified')) 
                                   OR (fb_uid = ? AND fb_uid <> '')""", (email, phone, fb_uid))
        result = list()
        for row in rows.fetchall():
            u = User(uid=row[0], email=row[1], phone=row[3], fb_uid=row[5], pwd=row[6])
            u.email_status = row[2]
            u.phone_status = row[4]
            result.append(u)
        return result

    def update(self, **kwds):
        if not kwds:
            return None
        conn = get_db()
        setter = []
        args = []
        for k, v in kwds.iteritems():
            setter.append(u' = '.join((k, '?')))
            args.append(v)
        args.append(self.uid)
        conn.execute("UPDATE users SET {} WHERE uid = ?".format(u', '.join(setter)), tuple(args)).fetchone()
        return True


    def delete(self):
        if not self.uid:
            return False
        conn = get_db()
        # TODO make sure this behaves nicely
        return bool(conn.execute("DELETE FROM users WHERE uid = ? AND tier < 0", (self.uid, )).rowcount)

    def check_pwd(self, pwd):
        if not self.pwd:
            return False
        return pbkdf2_sha512.verify(pwd, self.pwd)

    def signup(self, email, phone, pwd):
        if not self.uid:
            return False
        cur = get_db().cursor()
        passwd = pbkdf2_sha512.encrypt(pwd) if pwd is not None else None
        self.pwd = passwd
        if email:
            ok = bool(cur.execute("UPDATE users SET tier = 1, email = ?, email_status = 'unverified', password = ?, signup_at = datetime('now') WHERE uid = ? AND (SELECT count(uid) FROM users WHERE email = ? AND email_status <> 'invited') = 0", (email, passwd, self.uid, email)).rowcount)
            if ok:
                self.email = email
                self.email_status = 'unverified'
        elif phone:
            ok = bool(cur.execute("UPDATE users SET tier = 1, phone = ?, phone_status = 'unverified', password = ?, signup_at = datetime('now') WHERE uid = ? AND (SELECT count(uid) FROM users WHERE phone = ? AND phone_status <> 'invited') = 0", (phone, passwd, self.uid, phone)).rowcount)
            if ok:
                self.phone = phone
                self.phone_status = 'unverified'
        return ok

    def send_signup_token(self):
        if self.email and self.email_status == 'unverified':
            token = self.token('verify-email')
            print "generated verify-email token: ", token
            if not self.pwd:
                # send email with "set your pwd" copy
                send_email("signup-sinpass", "", self.email, dict(token=token))
            else:
                # send email with "verify your email" copy
                send_email("signup", "", self.email, dict(token=token))
        if self.phone and self.phone_status == 'unverified':
            pass

    @staticmethod
    def anon_token():
        token, hashed = gen_token()
        conn = get_db()
        conn.execute("INSERT INTO tokens (token, kind) VALUES (?, 'anon')", (hashed,))
        conn.commit()
        return token

    def token(self, kind):
        if not self.uid:
            return None
        conn = get_db()
        token, hashed = gen_token()
        if kind == 'login':
            conn.execute("INSERT INTO tokens (token, kind, uid) VALUES (?, 'login', ?)", (hashed, self.uid))
        elif kind == 'verify-email' and self.email:
            conn.execute("INSERT INTO tokens (token, kind, uid, email) VALUES (?, 'verify', ?, ?)", (hashed, self.uid, self.email))
        elif kind == 'verify-phone' and self.phone:
            conn.execute("INSERT INTO tokens (token, kind, uid, phone) VALUES (?, 'verify', ?, ?)", (hashed, self.uid, self.phone))
        else:
            return None
        conn.commit()
        return token

    def set_verified(self, email=None, phone=None):
        if not self.uid:
            return False
        conn = get_db()
        email_verif = phone_verif = False
        if email:
            email_verif = bool(conn.execute("""UPDATE users SET email_status = 'verified' 
                                              WHERE uid = ? 
                                                AND email = ? 
                                                AND (select count(uid) from users where email = ? and email_status = 'verified') = 0
                                           """, (self.uid, email, email)).rowcount)
        if phone:
            phone_verif = bool(conn.execute("""UPDATE users SET phone_status = 'verified' 
                                               WHERE uid = ? 
                                                 AND phone = ? 
                                                 AND (select count(uid) from users where phone = ? and phone_status = 'verified') = 0
                                            """, (self.uid, phone, phone)).rowcount)
        self.email_status = 'verified' if email_verif else self.email_status
        self.phone_status = 'verified' if phone_verif else self.phone_status
        return email_verif or phone_verif

    def copy_noterefs_from(self, user):
        if not self.uid or not user.uid:
            return None
        conn = get_db()
        cur = conn.cursor()
        cnt = 0
        for row in cur.execute("SELECT nid FROM noterefs WHERE uid = ?", (user.uid, )).fetchall():
            # TODO make sure that (uid, nid) constraint fails silently
            cnt += conn.execute("""INSERT INTO noterefs (nid, uid, status, role) 
                                           VALUES (?, ?, 'active', 'active')
                                """, (self.uid, row[0])).rowcount
        return cnt

    def steal_ownerships_from(self, user):
        if not self.uid or not user.uid:
            return None
        conn = get_db()
        cur = conn.cursor()
        ok = bool(cur.execute("UPDATE notes SET created_by = ? WHERE created_by = ?", (self.uid, user.uid)).rowcount)
        return ok

    def get_stripe_customer(self, token=None):
        conn = get_db()
        row = conn.execute("SELECT stripe_customer_id FROM users WHERE uid = ?", (self.uid,)).fetchone()
        if not row:
            raise Exception("cannot fetch stripe customer, uid ({}) does not exist".format(self.uid))
        cust_id = row[0]
        stripe.api_key = STRIPE_SECRET_KEY
        if not cust_id:
            if token is None:
                return None
            customer = stripe.Customer.create(
                    card=token,
                    email=self.email
                    )
            conn.execute("UPDATE users SET  stripe_customer_id = ? WHERE uid = ?", (customer.id, self.uid,))
            return customer
        else:
            return stripe.Customer.retrieve(cust_id)

    def change_plan(self, new_plan, token=None, force=False):
        if tokenhistory_seen(token):
            return "Replay attempt, token already used"
        elif new_plan not in User.PLANS:
            return "Trying to change to unknown plan, valid options: {0}".format(', '.join(User.PLANS.keys()))
        conn = get_db()
        row = conn.execute("SELECT plan FROM users WHERE uid = ?", (self.uid,)).fetchone()
        if not row:
            return "User with uid `{}` not found".format(self.uid)
        current_plan = row[0]
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
                now = datetime.now()
                last_day = calendar.monthrange(now.year, now.month)[1]
                expiry = now.replace(day=last_day, hour=23, minute=59)
                conn.execute("UPDATE users SET plan = ?, plan_expires_at = ? WHERE uid = ?", (new_plan, expiry, self.uid,))
        else:
            # handles up-/downgrades between paid plans and paid_upgade from free
            if stripe_customer:
                # tell stripe about subscription change
                stripe_customer.update_subscription(plan=new_plan)
                if token:
                    tokenhistory_add(token, self.uid)
            elif not force:
                return "Trying non-forced upgrade to paid plan without valid stripeToken"
            # make sure, previous plan-expirations are unset after upgrade
            conn.execute("UPDATE users SET plan = ?, plan_expires_at = '' WHERE uid = ?", (new_plan, self.uid))
        return None


class Session(object):
    def __init__(self, sid):
        self.sid = sid
        self.user = None
        self.token_user = None

    @classmethod
    def load(cls, sid):
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""select users.uid as uid, 
                              users.tier as tier, 
                              sharee.uid as sharee_uid, 
                              sharee.email as sharee_email,
                              sharee.phone as sharee_phone
                       FROM sessions
                       JOIN users as users
                         ON users.uid = sessions.uid 
                       LEFT OUTER JOIN users as sharee 
                         ON sharee.uid = (select uid from tokens where tokens.token = sessions.token_used AND tokens.kind IN ('share-email', 'share-phone'))
                            AND sharee.tier = -1
                       WHERE sessions.sid = ? 
                    """, (sid,))
        #TODO document tier = -1
        row = cur.fetchone()
        cur.close()
        if not row:
            return None
        sess = cls(sid)
        uid, tier = row[0], row[1]
        sharee_uid, sharee_email, sharee_phone = row[2], row[3], row[4]
        sess.user = User(uid, tier)
        if sharee_uid:
            sess.token_user = User(uid=sharee_uid, email=sharee_email, phone=sharee_phone)
        return sess

def tokenhistory_add(token, uid):
    conn = get_db()
    conn.execute("INSERT INTO stripe_tokens (token, uid, seen_at) VALUES (?, ?, datetime('now'))", (token, uid))

def tokenhistory_seen(token):
    conn = get_db()
    row = conn.execute("SELECT 1 FROM stripe_tokens WHERE token = ?", (token,)).fetchone()
    return bool(row)
