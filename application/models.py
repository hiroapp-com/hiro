import time
import json
from google.appengine.ext import ndb


class User(ndb.Model):
    token = ndb.StringProperty()
    email = ndb.StringProperty()
    password = ndb.StringProperty()
    signup_at =  ndb.DateTimeProperty()

     
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


    def to_json(self):
        result = {
                "id": self.key.id(),
                "title": self.title,
                "text": self.text,
                "created": time.mktime(self.created_at.timetuple()),
                "updated": time.mktime(self.updated_at.timetuple()),
                "cursor": self.cursor,
                "hidecontext": self.hidecontext,
                "links": []
                }
        return json.dumps(result, indent=2)
