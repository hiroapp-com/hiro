from flaskext import wtf
from flaskext.wtf import validators
from wtforms.ext.appengine.ndb import model_form, ModelConverter
from flask.ext.wtf.html5 import EmailField

from .models import User

class EmailFieldConverter(ModelConverter):

    def convert_StringProperty(self, model, prop, kwargs):
        if prop._name == 'email':
            return EmailField(**kwargs)
        else:
            return super(EmailFieldConverter, self).convert_StringProperty(model, prop, kwargs)

SignonForm = model_form(User, wtf.Form, converter=EmailFieldConverter(), field_args={
    'email': dict(validators=[validators.Required()]),
    'password': dict(validators=[validators.Required()]),
    })
