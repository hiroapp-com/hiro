"""
Initialize Flask app

"""
from flask import Flask

from flask.ext import login
from werkzeug.debug import DebuggedApplication
from gae_mini_profiler import profiler, templatetags
from custom_session import ItsdangerousSessionInterface

from application.models import User, Anonymous

from .assets import assets_env

app = Flask('application')
app.config.from_object('application.settings')


app.session_interface = ItsdangerousSessionInterface()


# Enable jinja2 loop controls extension
app.jinja_env.add_extension('jinja2.ext.loopcontrols')

@app.context_processor
def inject_profiler():
    return dict(profiler_includes=templatetags.profiler_includes())

assets = assets_env(app)
@app.context_processor
def inject_assets():
    ctx = {name: bundle.urls()[0] for name, bundle in assets._named_bundles.iteritems()}
    return dict(assets=ctx)


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
