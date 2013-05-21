"""
Initialize Flask app

"""
from flask import Flask

#from flask_debugtoolbar import DebugToolbarExtension
from gae_mini_profiler import profiler, templatetags
from werkzeug.debug import DebuggedApplication
from flask.ext import login

from application.models import User, Anonymous


app = Flask('application')
app.config.from_object('application.settings')

# Enable jinja2 loop controls extension
app.jinja_env.add_extension('jinja2.ext.loopcontrols')

@app.context_processor
def inject_profiler():
    return dict(profiler_includes=templatetags.profiler_includes())

# Pull in URL dispatch routes
import urls

login_manager = login.LoginManager()
login_manager.anonymous_user = Anonymous
login_manager.login_message = u"Please log in to access this page."

@login_manager.user_loader
def load_user(user_id):
    user = User.get_by_id(int(user_id))
    return user

login_manager.setup_app(app)

# Flask-DebugToolbar (only enabled when DEBUG=True)
#toolbar = DebugToolbarExtension(app)

# Werkzeug Debugger (only enabled when DEBUG=True)
if app.debug:
    app = DebuggedApplication(app, evalex=True)

# GAE Mini Profiler (only enabled on dev server)
app = profiler.ProfilerWSGIMiddleware(app)
