import os
import views

import click
import rollbar
import rollbar.contrib.flask

from flask import g, request, Flask, Markup, render_template, send_from_directory, got_request_exception
from assets import assets_env, get_html_output

app = Flask('application')
if os.environ.get('HIRO_ENV', '') == 'live':
    app.config.from_object('settings_live')
else:
    app.config.from_object('settings_dev')

# Enable jinja2 loop controls extension
app.jinja_env.add_extension('jinja2.ext.loopcontrols')

# Remove whitespaces from output HTML
app.jinja_env.add_extension('jinja2htmlcompress.HTMLCompress')


if not app.config['DEBUG']:
    print "initializing rollbar"
    from secret_keys import ROLLBAR_SERVER_TOKEN
    # setup rollbar exception handling
    rollbar.init(
            ROLLBAR_SERVER_TOKEN,
            # environment name
            'beta',  
            # server root directory, makes tracebacks prettier
            root=os.path.dirname(os.path.realpath(__file__)),  
            allow_logging_basic_config=True)

    # send exceptions from `app` to rollbar, using flask's signal system.
    got_request_exception.connect(rollbar.contrib.flask.report_exception, app)

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

def root_static():
    return send_from_directory(app.static_folder, request.path[1:])

def version_dev():
    return send_from_directory(app.static_folder+'/../', request.path[1:], mimetype='application/json')

## App Routes
# main handlers
app.add_url_rule('/', 'home', view_func=views.home, methods=['GET'])
app.add_url_rule('/crash', 'crash', view_func=views.crash, methods=['GET'])
app.add_url_rule('/note/<note_id>', 'note', view_func=views.note)
# Backdoor pages
app.add_url_rule('/backdoor', 'backdoor', view_func=views.backdoors, methods=['GET'], defaults={'page': 'imgmodal'})
app.add_url_rule('/beta', 'beta', view_func=views.backdoors, methods=['GET'], defaults={'page': 'beta'})
# About bpages
app.add_url_rule('/is', 'is', view_func=views.about, methods=['GET'])
# token handlers
app.add_url_rule('/tokens/anon', 'anontoken', view_func=views.anon, methods=['GET'])
app.add_url_rule('/tokens/login', 'login', view_func=views.login, methods=['POST'])
app.add_url_rule('/tokens/signup', 'signup', view_func=views.register, methods=['POST'])
app.add_url_rule('/tokens/resetpwd', 'req_reset_pwd', view_func=views.req_reset_pwd, methods=['POST'])
app.add_url_rule('/tokens/verify', 'verify', view_func=views.verify, methods=['POST'])
# components (e.g. landingpage, settings container)
app.add_url_rule('/component/landing/<landing_id>', 'landing', view_func=views.landing)
app.add_url_rule('/component/settings/', 'settings', view_func=views.settings)
app.add_url_rule('/offline/app.html', 'offline', view_func=views.offline)
app.add_url_rule('/static/hiro.appcache', 'appcache', view_func=views.static_manifest)
# facebook & stripe callbacks
app.add_url_rule('/connect/facebook', 'fb_connect', view_func=views.fb_connect)
app.add_url_rule('/_cb/facebook', 'fb_callback', view_func=views.fb_callback, methods=['GET','POST'])
app.add_url_rule('/settings/plan', 'change_plan', view_func=views.change_plan, methods=['POST'])
app.add_url_rule('/settings/setpwd', 'set_pwd', view_func=views.set_pwd, methods=['POST'])
# root-based static files
app.add_url_rule('/favicon.ico', 'favicon', view_func=root_static)
app.add_url_rule('/apple-touch-icon-precomposed.png', 'icon', view_func=root_static)   
app.add_url_rule('/og.png', 'og', view_func=root_static)     
app.add_url_rule('/robots.txt', 'robots', view_func=root_static)    
app.add_url_rule('/version', 'version', view_func=version_dev)    

@click.command()
@click.option('--addr', default='127.0.0.1', help='Bind http listener to this socket')
@click.option('--port', default=5000, help='Listen on this port for incoming HTTP requests.')
def run_server(addr, port):
    app.run(host=addr, port=port)

@app.teardown_appcontext
def close_db(error):
    if hasattr(g, 'db'):
        g.db.commit()
        g.db.close()

if __name__ == '__main__':
    run_server()

