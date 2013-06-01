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

def is_email_registered(form, field):
    if User.query(User.email == field.data).get() is None:
        raise validators.StopValidation("E-Mail not registered.")

LoginForm = model_form(User, wtf.Form, converter=EmailFieldConverter(), field_args={
    'email': dict(validators=[validators.Required(), validators.Email(), is_email_registered]),
    'password': dict(validators=[validators.Required()]),
    })

SignupForm = model_form(User, wtf.Form, converter=EmailFieldConverter(), field_args={
    'email': dict(validators=[validators.Required(), validators.Email()]),
    'password': dict(validators=[validators.Required()]),
    })
