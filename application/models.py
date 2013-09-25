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
from flask import session
from textmodels.textrank import get_top_keywords_list
from settings import STRIPE_SECRET_KEY

from .utils import get_sorted_chunks


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
    latest_doc = property(lambda self: Document.query(Document.owner == self.key).order(-Document.updated_at).get())

    signup_at_ts = property(lambda self: time.mktime(self.signup_at.timetuple()))

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
     

class Document(ndb.Model):
    owner = ndb.KeyProperty(kind=User)
    title = ndb.StringProperty()
    status = ndb.StringProperty(default='active', choices=('active', 'archived')) 
    text = ndb.TextProperty()
    cursor = ndb.IntegerProperty()
    hidecontext = ndb.BooleanProperty()
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    updated_at = ndb.DateTimeProperty(auto_now=True)

    # contextual links
    sticky = ndb.StructuredProperty(Link, repeated=True)
    blacklist = ndb.StructuredProperty(Link, repeated=True)
    cached_ser = ndb.StructuredProperty(Link, repeated=True)
    

    def allow_access(self, user):
        return user.key == self.owner 

    def analyze(self):
        data = (self.title or '') + (self.text or '')
        data = data.replace(os.linesep, ',') 
        normal_noun_chunks, proper_noun_chunks = get_sorted_chunks(data)
        textrank_chunks = get_top_keywords_list(data, 8)
        return {'textrank_chunks': textrank_chunks, 
                'noun_chunks': normal_noun_chunks, 
                'proper_chunks':proper_noun_chunks
                }

    def api_dict(self):
        return {
                "id": self.key.id(),
                "status": self.status,
                "title": self.title,
                "text": self.text,
                "created": time.mktime(self.created_at.timetuple()),
                "updated": time.mktime(self.updated_at.timetuple()),
                "cursor": self.cursor,
                "hidecontext": self.hidecontext,
                "links": {
                    "normal": [c.to_dict() for c in self.cached_ser],
                    "sticky": [c.to_dict() for c in self.sticky],
                    "blacklist": [c.url for c in self.blacklist]
                    }
                }
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




    
