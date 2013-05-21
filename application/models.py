import time

from passlib.hash import pbkdf2_sha512
from google.appengine.ext import ndb
from flask.ext.login import UserMixin, AnonymousUser


class User(UserMixin, ndb.Model):
    token = ndb.StringProperty()
    email = ndb.StringProperty()
    password = ndb.StringProperty()
    signup_at =  ndb.DateTimeProperty(auto_now_add=True)

    @classmethod
    def hash_password(cls, pwd):
        return pbkdf2_sha512.encrypt(pwd)

    def check_password(self, candidate):
        return pbkdf2_sha512.verify(candidate, self.password)

    def get_id(self):
        return unicode(self.key.id())


class Anonymous(AnonymousUser):
    name = u"Anonymous"

     
class Context(ndb.Expando):
    type = ndb.StringProperty(required=True) # e.g. "link"
    hash = ndb.StringProperty(required=True) # used for blacklist filtering
    

class Document(ndb.Model):
    title = ndb.StringProperty()
    text = ndb.TextProperty()
    cursor = ndb.IntegerProperty()
    hidecontext = ndb.BooleanProperty()
    created_at = ndb.DateTimeProperty(auto_now_add=True)
    updated_at = ndb.DateTimeProperty(auto_now=True)
    sticky = ndb.StructuredProperty(Context, repeated=True)
    blacklist = ndb.StructuredProperty(Context, repeated=True)
    cached = ndb.StructuredProperty(Context, repeated=True)

    def to_dict(self):
        return {
                "id": self.key.id(),
                "title": self.title,
                "text": self.text,
                "created": time.mktime(self.created_at.timetuple()),
                "updated": time.mktime(self.updated_at.timetuple()),
                "cursor": self.cursor,
                "hidecontext": self.hidecontext,
                "links": []
                }
