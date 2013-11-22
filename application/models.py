from pprint import pformat
import re
import os
import uuid
import time
import calendar
import json
from hashlib import sha512
from datetime import datetime

import stripe
from passlib.hash import pbkdf2_sha512
from google.appengine.ext import ndb
from google.appengine.api import memcache, channel
from flask.ext.login import UserMixin, AnonymousUser, current_user
from flask import session
from textmodels.textrank import get_top_keywords_list
from settings import STRIPE_SECRET_KEY

from .utils import get_sorted_chunks
from .email_templates import send_mail_tpl

from diff_match_patch import diff_match_patch 

DMP = diff_match_patch()
base_url = 'http://localhost:8080/' if 'Development' in os.environ['SERVER_SOFTWARE'] else 'https://alpha.hiroapp.com/'

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
    latest_doc = property(lambda self: Document.query(ndb.OR(Document.owner == self.key, 
                                                             Document.shared_with == self.key)).order(-Document.updated_at).get())

    signup_at_ts = property(lambda self: time.mktime(self.signup_at.timetuple()))

    def push_message(self, msg):
        for sess in EditSession.query(EditSession.user == self.key):
            channel.send_message(str(sess.key.id()), json.dumps(msg))


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
    updated_at = ndb.DateTimeProperty(auto_now=True)
    shared_with = ndb.KeyProperty(kind=User, repeated=True)

    # contextual links
    sticky = ndb.StructuredProperty(Link, repeated=True)
    blacklist = ndb.StructuredProperty(Link, repeated=True)
    cached_ser = ndb.StructuredProperty(Link, repeated=True)

    collaborators = property(lambda s: s.shared_with + [s.owner])

    def allow_access(self, user, token=None):
        if not user.is_authenticated():
            return False
        if user.key == self.owner:
            return True
        if user.key in self.shared_with:
            return True
        st = SharingToken.get_by_id(sha512(token).hexdigest(), parent=self.key) if token else None
        if st:
            self.shared_with.append(user.key)
            self.put()
            if st.use_once:
                st.key.delete()
            return True
        return False


    def analyze(self):
        data = (self.title or '') + (self.text or '')
        data = data.replace(os.linesep, ',') 
        normal_noun_chunks, proper_noun_chunks = get_sorted_chunks(data)
        textrank_chunks = get_top_keywords_list(data, 8)
        return {'textrank_chunks': textrank_chunks, 
                'noun_chunks': normal_noun_chunks, 
                'proper_chunks':proper_noun_chunks
                }

    def uninvite(self, user_id, email):
        #TODO drop editors from self.shared_with if requestor is owner
        if user_id:
            self.shared_with.remove(ndb.Key(User, int(user_id)))
            self.put()
        elif email:
            ndb.delete_multi(list(SharingToken.query(SharingToken.email == email, ancestor=self.key).iter(keys_only=True)))

    def invite(self, email):
        if SharingToken.query(SharingToken.email == email, ancestor=self.key).get():
            return "invite pending", 302
        user = User.query(User.email == email).get()
        if not user:
            token = SharingToken.create(email, self.key)
            print "TTTOOOOKEEENN >>", token, "<<"
            send_mail_tpl('invite', email, dict(sender=current_user.email or "foo", url=base_url, token=token))
            return "ok", 200

        if user.key == self.owner:
            return "it's all yours", 302
        elif user.key  in self.shared_with:
            return "already a member of this clique", 302
        else:
            self.shared_with.append(user.key)
            self.put()
            #notify user
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
                "shared_with": [u.get().email for u in self.shared_with],
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


class Edit(ndb.Model):
    server_version = ndb.IntegerProperty(default=0)
    client_version = ndb.IntegerProperty(default=0)
    delta = ndb.TextProperty()
    force = ndb.BooleanProperty(default=False)

    def to_dict(self):
        return {
            'serverversion': self.server_version,
            'clientversion': self.client_version,
            'delta': self.delta,
            'force': self.force
            }


class EditSession(ndb.Model):
    user = ndb.KeyProperty(kind=User)
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    last_used_at = ndb.DateTimeProperty()
    shadow = ndb.TextProperty()
    server_version = ndb.IntegerProperty(default=0)
    client_version = ndb.IntegerProperty(default=0)
    backup = ndb.TextProperty()
    backup_version = ndb.IntegerProperty(default=0)

    edit_stack = ndb.StructuredProperty(Edit, repeated=True)


    def get_doc(self):
        return self.key.parent().get()

    @ndb.transactional()
    def apply_edits(self, stack):
        ok = True
        changed = False
        doc = self.get_doc()
        mastertext, shadow = doc.text, self.shadow
        for edit in stack:
            sv, cv, delta = edit['serverversion'], edit['clientversion'], edit['delta']

            # if server-ACK lost, rollback to backup
            if sv != self.server_version and sv == self.backup_version:
                print "SV MISMATCH: RECOVERING FROM BACKUP"
                shadow = self.backup
                self.server_version = self.backup_version
                self.edit_stack = []

            # clear client-ACK'd edits from server stack
            self.edit_stack = [e for e in self.edit_stack if e.server_version > sv]

            # start the delta-fun!
            if sv != self.server_version:
                # version mismatch
                #request re-sync
                raise Exception("sv mismatch")
                ok = False
            elif cv > self.client_version:
                # client in the future?
                #request re-sync
                raise Exception("cv mismatch")
                ok = False
            elif cv < self.client_version:
                # dupe
                pass
            else:
                try:
                    diffs = DMP.diff_fromDelta(shadow, delta)
                    if len(diffs) > 1 or (len(diffs) == 1 and diffs[0][0] != DMP.DIFF_EQUAL):
                        changed = True
                except ValueError, e:
                    #request re-sync
                    raise e
                    diffs = None
                    ok = False
                self.client_version += 1
                if diffs:
                    # patch master-doc
                    patches = DMP.patch_make(shadow, diffs)
                    shadow = DMP.diff_text2(diffs)
                    self.backup = shadow
                    self.backup_version = self.server_version
                    mastertext, res = DMP.patch_apply(patches, mastertext)
                    mastertext = re.sub(r"(\r\n|\r|\n)", "\n", mastertext)

        # render output
        if ok:
            diffs = DMP.diff_main(shadow, mastertext)
            DMP.diff_cleanupEfficiency(diffs)
            delta = DMP.diff_toDelta(diffs)
            print "delta!", pformat(delta)
            self.edit_stack.append(Edit(server_version=self.server_version, 
                                        client_version=self.client_version,
                                        delta=delta))
            self.server_version += 1
            doc.text = mastertext
            self.shadow = mastertext
            doc.put()
            self.put()
        else:
            self.client_version += 1
            self.edit_stack.append(Edit(server_version=self.server_version, 
                                        client_version=self.client_version,
                                        delta=mastertext, force=True))
        return changed

        
    def notify_viewers(self):
        doc = self.get_doc()
        users = list(doc.shared_with) + [doc.owner]
        users.remove(self.user)
        msg = {"kind": "edit", 
               "doc_id": doc.key.id(), 
               "user": self.user.get().email
               }
        for u in users:
            u.get().push_message(msg)
