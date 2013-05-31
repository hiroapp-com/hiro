import time
import calendar
from datetime import datetime

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

    
