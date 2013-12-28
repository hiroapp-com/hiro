import os
import uuid
import time
import calendar
from hashlib import sha512
from datetime import datetime

import stripe
from passlib.hash import pbkdf2_sha512
from google.appengine.ext import ndb
from google.appengine.api import memcache
from flask.ext.login import UserMixin, AnonymousUser
from flask import session, url_for
from textmodels.textrank import get_top_keywords_list
from settings import STRIPE_SECRET_KEY

from .utils import get_sorted_chunks
from .email_templates import send_mail_tpl
from .diffsync import SyncSession

from diff_match_patch import diff_match_patch 

DMP = diff_match_patch()
base_url = 'http://localhost:8080' if 'Development' in os.environ['SERVER_SOFTWARE'] else 'https://alpha.hiroapp.com'

class PlanChange(ndb.Model):
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    old = ndb.StringProperty()
    new = ndb.StringProperty()

class User(UserMixin, ndb.Model):
    PLANS = {'free': 1,
             'starter': 2,
             'pro': 3
             }
    PAID_PLANS = ('starter', 'pro')

    token = ndb.StringProperty()
    email = ndb.StringProperty()
    name = ndb.StringProperty(default='')
    plan = ndb.StringProperty(default='free')
    plan_history = ndb.StructuredProperty(PlanChange, repeated=True)
    plan_expires_at = ndb.DateTimeProperty()
    password = ndb.StringProperty()
    signup_at =  ndb.DateTimeProperty(auto_now_add=True)
    facebook_uid = ndb.StringProperty()
    stripe_cust_id = ndb.StringProperty()
    relevant_counter = ndb.IntegerProperty(default=0)
    has_root = ndb.BooleanProperty(default=False)
    tier = property(lambda self: User.PLANS.get(self.plan, 0))
    has_paid_plan = property(lambda self: self.plan in User.PAID_PLANS)
    latest_doc = property(lambda self: DocAccess.query(DocAccess.user == self.key).order(-DocAccess.last_change_at).get().doc.get())

    signup_at_ts = property(lambda self: time.mktime(self.signup_at.timetuple()))
    custom_css = ndb.StringProperty(default='')


    def push_message(self, msg):
        i = 0
        for da in DocAccess.query(DocAccess.user == self.key):
            for sess_id in da.sync_sessions:
                sess = SyncSession.fetch(sess_id)
                if sess:
                    sess.push(msg)
                    i += 1
                else:
                    # session expired, remove from list
                    da.sync_sessions.remove(sess_id)
            da.put()
        return i


    @property
    def active_cc(self):
        #TODO: cache invalidation as soon as we support card edit/delete
        if not self.stripe_cust_id:
            return None
        cache_key = 'stripe.active_card:{0}'.format(self.stripe_cust_id)
        cc = memcache.get(cache_key)
        if cc is None:
            customer = self.get_stripe_customer()
            if customer:
                stripe_cc = customer.get('active_card', {})
                cc = {u'type': stripe_cc.type,
                      u'last4': stripe_cc.last4,
                      u'exp_year': stripe_cc.exp_year,
                      u'exp_month': stripe_cc.exp_month,
                      }
                memcache.set(cache_key, cc, time=60*60*2)
        return cc


    def get_stripe_customer(self, token=None):
        stripe.api_key = STRIPE_SECRET_KEY
        if not self.stripe_cust_id:
            if token is None:
                return None
            customer = stripe.Customer.create(
                    card=token,
                    email=self.email
                    )
            self.stripe_cust_id = customer.id
            self.put()
            return customer
        else:
            return stripe.Customer.retrieve(self.stripe_cust_id)

    def stripe_token_unused(self, token):
        if not token:
            return True
        token_already_used = StripeToken.get_by_id(token)
        return not token_already_used

    def change_plan(self, new_plan, token=None, force=False):
        if not self.stripe_token_unused(token):
            return None, "Raplay attempt, token already used"
        elif new_plan not in User.PLANS:
            return None, "Trying to change to unknown plan, valid options: {0}".format(', '.join(User.PLANS.keys()))
        elif self.plan == new_plan:
            # makes no sense, dude
            return None, "Cannot change to plan you already have"

        # communicate changes to stripe, if necessary
        stripe_customer = self.get_stripe_customer(token)
        if self.has_paid_plan and new_plan not in User.PAID_PLANS:
            # cancel paid plan
            if stripe_customer:
                stripe_customer.cancel_subscription(at_period_end=True)
                # subscription will end by the end of the month, save how
                # it's still paid for and deactivate after expiration, see XXX
                # TODO: backgroundtask for expired plan cancelation
                now = datetime.now()
                last_day = calendar.monthrange(now.year, now.month)[1]
                self.plan_expires_at = now.replace(day=last_day, hour=23, minute=59)
        else:
            # handles up-/downgrades between paid plans and paid_upgade from free
            if stripe_customer:
                # tell stripe about subscription change
                stripe_customer.update_subscription(plan=new_plan)
                if token:
                    StripeToken(id=token, used_by=self.key).put()
            elif not force:
                return None, "Trying non-forced upgrade to paid plan without valid stripeToken"
            if self.plan_expires_at:
                # do not expire plan if user upgraded to paid again after previous cancellation
                self.plan_expires_at = None

        plan_change = PlanChange(old=self.plan, new=new_plan)
        self.plan_history.append(plan_change)
        self.plan = new_plan
        self.put()
        return plan_change, ''

    @classmethod
    def hash_password(cls, pwd):
        return pbkdf2_sha512.encrypt(pwd)

    def check_password(self, candidate):
        if self.password:
            return pbkdf2_sha512.verify(candidate, self.password)
        else:
            # empty password is disabled password, e.g. fb connected user
            return False

    def get_id(self):
        return unicode(self.key.id())

    @property
    def usage_quota(self):
        if self.has_paid_plan:
            return float('inf')
        return 100

    def _get_usage_ctr(self):
        key = 'relevant.counter:{0}'.format(self.key.id())
        cached = memcache.get(key)
        return cached if cached is not None else self.relevant_counter

    def _set_usage_ctr(self, val):
        key = 'relevant.counter:{0}'.format(self.key.id())
        memcache.set(key, val)
        if val % 5 == 0:
            # write to db at certain times:
            # hope that changes only happen incremently
            self.relevant_counter = val
            self.put()

    usage_ctr = property(_get_usage_ctr, _set_usage_ctr)
    del _get_usage_ctr, _set_usage_ctr

    def to_dict(self):
        return {
                'id': self.get_id(),
                'name': self.name,
                'email': self.email,
                'tier': self.tier
                }


class Anonymous(AnonymousUser):
    name = u"Anonymous"
    has_paid_plan = False
    latest_doc = None
    usage_quota = 10
    has_root = False

    def _get_usage_ctr(self):
        return session.get('usage-relevant', 0)

    def _set_usage_ctr(self, val):
        session['usage-relevant'] = val

    usage_ctr = property(_get_usage_ctr, _set_usage_ctr)
    del _get_usage_ctr, _set_usage_ctr


class Link(ndb.Model):
    url = ndb.StringProperty(required=True)
    title = ndb.StringProperty()
    description = ndb.StringProperty()

    def to_dict(self):
        return {
                'url': self.url,
                'title': self.title,
                'description': self.description
                }
     
#NOTE SharingToken will be removed after migration to DocAccess
class SharingToken(ndb.Model):
    #hash of token is stored as the key
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    email = ndb.StringProperty()
    use_once = ndb.BooleanProperty()

    doc = property(lambda(s): s.key.parent().get())


    @classmethod
    def create(cls, email, parent):
        token = uuid.uuid4().hex
        key = sha512(token).hexdigest()
        cls(id=key, email=email, use_once=True, parent=parent).put()
        return token


    def send_invitation(self):
        pass


class Document(ndb.Model):
    owner = ndb.KeyProperty(kind=User)
    title = ndb.StringProperty()
    status = ndb.StringProperty(default='active', choices=('active', 'archived')) 
    text = ndb.TextProperty()
    cursor = ndb.IntegerProperty()
    hidecontext = ndb.BooleanProperty()
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    #note: updated_at will soon be deprecated
    updated_at = ndb.DateTimeProperty(auto_now=True)

    # de-normalized properties updated async by TaskQueue
    last_update_at = ndb.DateTimeProperty()
    last_update_by = ndb.KeyProperty(kind=User, indexed=False)
    access_list = ndb.KeyProperty(kind='DocAccess', repeated=True)

    # contextual links
    sticky = ndb.StructuredProperty(Link, repeated=True)
    blacklist = ndb.StructuredProperty(Link, repeated=True)
    cached_ser = ndb.StructuredProperty(Link, repeated=True)

    excerpt = property(lambda s: s.text[:500])

    def grant(self, user, token=None):
        if not user.is_authenticated():
            return None
        token_hash = sha512(token).hexdigest() if token else ""
        access = DocAccess.query(DocAccess.doc == self.key, ndb.OR(DocAccess.user == user.key,
                                                                   ndb.AND(DocAccess.token_hash != "",
                                                                           DocAccess.token_hash == token_hash))).get()
        if access and not access.user:
            #consume invite token
            access.user = user.key
            access.token_hash = ''
            access.status = 'active'
            access.put()
        return access

    def analyze(self):
        data = (self.title or '') + (self.text or '')
        data = data.replace(os.linesep, ',') 
        normal_noun_chunks, proper_noun_chunks = get_sorted_chunks(data)
        textrank_chunks = get_top_keywords_list(data, 8)
        return {'textrank_chunks': textrank_chunks, 
                'noun_chunks': normal_noun_chunks, 
                'proper_chunks':proper_noun_chunks
                }


    def invite(self, email, invited_by):
        if DocAccess.query(DocAccess.email == email, DocAccess.user == None).get():
            return "invite pending", 302
        user = User.query(User.email == email).get()
        url = base_url + url_for("note", doc_id=self.key.id())
        if not user:
            da, token = DocAccess.create(self, email=email)
            send_mail_tpl('invite', email, dict(invited_by=invited_by, url=url, token=token, doc=self))
            return "ok", 200

        if DocAccess.query(DocAccess.doc == self.key, DocAccess.user == user.key).get():
            return "Already part of this clique", 302
        else:
            da, token = DocAccess.create(self, user=user, status='active')
            #notify user
            active_sessions = user.push_message({"kind": "share", 
                                                 "doc_id": str(self.key.id()), 
                                                 "origin": {
                                                     "user_id": invited_by.get_id(),
                                                     "email": invited_by.email,
                                                     "name": invited_by.name
                                                     }
                                                 })
            if not active_sessions:
                send_mail_tpl('invite', email, dict(invited_by=invited_by, invitee=user, url=url, token=token, doc=self))
            return "ok", 200



    def api_dict(self):
        return {
                "id": self.key.id(),
                "owner": str(self.owner.id()),
                "status": self.status,
                "title": self.title,
                "text": self.text,
                "created": time.mktime(self.created_at.timetuple()),
                "updated": time.mktime(self.updated_at.timetuple()),
                "cursor": self.cursor,
                "hidecontext": self.hidecontext,
                "shared": DocAccess.query(DocAccess.doc == self.key).count() > 1,
                "links": {
                    "normal": [c.to_dict() for c in self.cached_ser],
                    "sticky": [c.to_dict() for c in self.sticky],
                    "blacklist": [c.url for c in self.blacklist]
                    }
                }


class DeltaLog(ndb.Model):
    delta = ndb.JsonProperty('d')
    timestamp = ndb.DateTimeProperty('ts', auto_now_add=True)


class DocAccess(ndb.Model):
    """ Generic Document access association and book-keeping. 
    
        User reference is optional (e.g. if invited but not accepted) 
        and exact usage of token_hash is open to the creator (e.g. emailed or used as public hash)
    """
    # association and metainfo
    #future status: 'public', 'declined', 'revoked'
    role = ndb.StringProperty(default='collab', choices=('collab', 'owner')) 
    status = ndb.StringProperty(default='invited', choices=('invited', 'active', 'archived')) 
    doc = ndb.KeyProperty(kind=Document, required=True)
    user = ndb.KeyProperty(kind=User)
    email = ndb.StringProperty()
    token_hash =  ndb.StringProperty()
    hidecontext = ndb.BooleanProperty(default=False)
    
    # backlogs and session-references
    deltalog = ndb.StructuredProperty(DeltaLog, repeated=True)
    sync_sessions = ndb.StringProperty(repeated=True)

    # various timestamps
    last_change_at = ndb.DateTimeProperty(default=datetime.min) # will not be updated on "=<len>"(no-op) deltas
    last_access_at = ndb.DateTimeProperty(default=datetime.min)
    created_at = ndb.DateTimeProperty(auto_now_add=True)

    
    @classmethod
    def create(cls, doc, user=None, role='collab', status='invited', email=None):
        token = uuid.uuid4().hex
        hashed = sha512(token).hexdigest()
        obj = cls(token_hash=hashed, doc=doc.key, role=role, status=status, email=email)
        if user:
            obj.user = user.key
        obj.put()
        return obj, token

    def tick_seen(self, also_changed=False):
        self.last_access_at = datetime.now()
        if also_changed:
            self.last_change_at = self.last_access_at
        self.put()

    def create_session(self):
        sess = SyncSession.create(self.doc.get().text, user_id=(self.user.id() if self.user else None))
        self.sync_sessions.append(sess['session_id'])
        self.put()
        return sess

    def _pre_put_hook(self):
        self.deltalog = self.deltalog[:100]



class StripeToken(ndb.Model):
    used_by = ndb.KeyProperty(kind=User)
    created_at = ndb.DateTimeProperty(auto_now_add=True)

class PasswordToken(ndb.Model):
    user = ndb.KeyProperty(kind=User)
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    #hash = ndb.StringProperty()

    @classmethod
    def create_for(cls, user):
        # since we only store a hash of the token, we cannot
        # reuse tokens. thus, clean up old ones before creating 
        # a new one
        PasswordToken.query(PasswordToken.user == user.key).map(lambda e: e.key.delete())
        token = uuid.uuid4().hex
        key = sha512(token).hexdigest()
        obj = cls(id=key, user=user.key)
        obj.put()
        return token








