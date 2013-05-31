import time

import stripe
from passlib.hash import pbkdf2_sha512
from google.appengine.ext import ndb
from flask.ext.login import UserMixin, AnonymousUser
from textmodels.textrank import get_top_keywords_list
from settings import STRIPE_SECRET_KEY

from .utils import get_sorted_chunks


class PlanChange(ndb.Model):
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    old = ndb.StringProperty()
    new = ndb.StringProperty()

class User(UserMixin, ndb.Model):
    PLANS = {'anon': 0,
             'free': 1,
             'starter': 2,
             'pro': 3
             }
    PAID_PLANS = ('starter', 'pro')

    token = ndb.StringProperty()
    email = ndb.StringProperty()
    plan = ndb.StringProperty(default='free')
    plan_history = ndb.StructuredProperty(PlanChange, repeated=True)
    password = ndb.StringProperty()
    signup_at =  ndb.DateTimeProperty(auto_now_add=True)
    facebook_uid = ndb.StringProperty()
    stripe_cust_id = ndb.StringProperty()

    tier = property(lambda self: User.PLANS.get(self.plan, 0))
    has_paid_plan = property(lambda self: self.plan in User.PAID_PLANS)

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




    def change_plan(self, to, token=None, force=False):
        #TODO: handle downgrades properly (contact stripe about subscriptionchange)
        if to not in User.PLANS:
            #TODO implement cancelation
            return None, "computer says no"
        elif self.plan == to:
            # makes no sense, dude
            return None, "computer says no"

        # if token was passed (i.e. CC card was entered), pass
        # token on to customer-getter. beware that if the
        # user has already a strip-customer associated, the
        # token will be ignored. 
        customer = self.get_stripe_customer(token)
        if customer is None:
            # not existing user and token is empty/invalid
            return None, "computer says no"
        customer.update_subscription(plan=to, prorate=True)
        plan_change = PlanChange(old=self.plan, new=to)
        self.plan_history.append(plan_change)
        self.plan = to
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

    def to_dict(self):
        return {
                'id': self.get_id(),
                'email': self.email,
                'tier': self.tier
                }


class Anonymous(AnonymousUser):
    name = u"Anonymous"
    has_paid_plan = False

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
        normal_noun_chunks, proper_noun_chunks = get_sorted_chunks(data)
        textrank_chunks = get_top_keywords_list(data, 8)
        return {'textrank_chunks': textrank_chunks, 
                'noun_chunks': normal_noun_chunks, 
                'proper_chunks':proper_noun_chunks
                }

    def to_dict(self):
        return {
                "id": self.key.id(),
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

    
