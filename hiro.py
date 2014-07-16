"""
Initialize Flask app

"""
import sqlite3
import views

from flask import Flask, Markup, render_template, g
from passlib.hash import pbkdf2_sha512
from assets import assets_env, get_html_output

app = Flask('application')
app.config.from_object('settings')

DB_PATH = 'C:\local\hync\hiro.db'


# Enable jinja2 loop controls extension
app.jinja_env.add_extension('jinja2.ext.loopcontrols')

# Remove whitespaces from output HTML
app.jinja_env.add_extension('jinja2htmlcompress.HTMLCompress')

assets = assets_env(app)
@app.context_processor
def inject_asset_getter():
    def get_asset(name):
        bundle = assets._named_bundles[name]
        return Markup(get_html_output(bundle.urls()))
    def get_asset_url(name):
        bundle = assets._named_bundles[name]
        return Markup(u'\n'.join(bundle.urls()))
    return dict(get_asset=get_asset, get_asset_url=get_asset_url)



## Error handlers
# Handle 404 errors
@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html'), 404

# Handle 500 errors
@app.errorhandler(500)
def server_error(e):
    return render_template('500.html'), 500

def verify_pwd(candidate, pwd):
    return int(pbkdf2_sha512.verify(candidate, pwd))

def get_db():
    if not hasattr(g, 'db'):
        g.db = sqlite3.connect(DB_PATH)
    return g.db

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'db'):
        g.db.commit()
        g.db.close()

if __name__ == '__main__':
    app.add_url_rule('/', 'home', view_func=views.home, methods=['GET'])
    app.add_url_rule('/tokens/anon', 'anontoken', view_func=views.anon, methods=['GET'])
    app.add_url_rule('/tokens/login', 'login', view_func=views.login, methods=['POST'])
    app.add_url_rule('/tokens/signup', 'signup', view_func=views.register, methods=['POST'])
    app.add_url_rule('/component/landing/', 'landing', view_func=views.landing)
    app.add_url_rule('/component/settings/', 'settings', view_func=views.settings)
    app.add_url_rule('/offline/app.html', 'offline', view_func=views.offline)
    app.add_url_rule('/note/<note_id>', 'note', view_func=views.note)
    app.add_url_rule('/offline/manifestwrapper/', 'manifestwrapper', view_func=views.manifestwrapper)
    app.add_url_rule('/static/hiro.appcache', 'appcache', view_func=views.static_manifest)
    app.run()
