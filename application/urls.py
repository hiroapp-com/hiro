from flask import render_template

from application import app
from application import views


## URL dispatch rules
# App Engine warm up handler
# See http://code.google.com/appengine/docs/python/config/appconfig.html#Warming_Requests
app.add_url_rule('/_ah/warmup', 'warmup', view_func=views.warmup)

# pages
app.add_url_rule('/', 'home', view_func=views.home)
app.add_url_rule('/static/hiro.appcache', 'static_manifest', view_func=views.static_manifest)
app.add_url_rule('/landing/', 'landing', view_func=views.landing)
app.add_url_rule('/settings/', 'settings', view_func=views.settings)
app.add_url_rule('/test/', 'test', view_func=views.test)
app.add_url_rule('/shiny/', 'newhome', view_func=views.newhome)
app.add_url_rule('/newsettings/', 'newsettings', view_func=views.newsettings)

# payment
app.add_url_rule('/settings/plan', 'change_plan', view_func=views.change_plan, methods=['POST'])
app.add_url_rule('/me', 'profile', view_func=views.profile, methods=['GET', 'POST'])

# auth
app.add_url_rule('/register', 'register', view_func=views.register, methods=['POST'])
app.add_url_rule('/login', 'login', view_func=views.login, methods=['POST'])
app.add_url_rule('/logout', 'logout', view_func=views.logout, methods=['GET', 'POST'])
app.add_url_rule('/reset_password', 'create_token', view_func=views.create_token, methods=['POST'])
app.add_url_rule('/reset/<token>', 'reset_password', view_func=views.reset_password, methods=['POST'])
app.add_url_rule('/connect/facebook', 'fb_connect', view_func=views.fb_connect, methods=['GET'])
app.add_url_rule('/_cb/facebook', 'fb_callback', view_func=views.fb_callback, methods=['GET', 'POST'])
app.add_url_rule('/_hro/notify_sessions', 'notify_sessions', view_func=views.notify_sessions, methods=['POST'])
app.add_url_rule('/_hro/update_doc', 'update_doc_stats', view_func=views.update_doc_stats, methods=['POST'])
app.add_url_rule('/note/<doc_id>', 'note', view_func=views.note, methods=['GET'])

# super-user only realm, AAA pass required.
#app.add_url_rule('/_schemamigration', 'schemamigration', view_func=views.schemamigration, methods=['GET'])
app.add_url_rule('/_magick', '_manual_intervention', view_func=views._manual_intervention, methods=['GET'])

# document store
app.add_url_rule('/docs/', 'list_documents', view_func=views.list_documents, methods=['GET'])
app.add_url_rule('/docs/', 'create_document', view_func=views.create_document, methods=['POST'])
app.add_url_rule('/docs/<doc_id>', 'get_document', view_func=views.get_document, methods=['GET'])
app.add_url_rule('/docs/<doc_id>', 'edit_document', view_func=views.edit_document, methods=['PATCH', 'POST'])
app.add_url_rule('/docs/<doc_id>/collaborators', 'collaborators', view_func=views.doc_collaborators, methods=['GET', 'POST'])
app.add_url_rule('/docs/<doc_id>/sync', 'sync_doc', view_func=views.sync_doc, methods=['POST'])

# textanalysis & semantic search
app.add_url_rule('/analyze', 'analyze_content', view_func=views.analyze_content, methods=['POST'])
app.add_url_rule('/relevant', 'relevant', view_func=views.relevant_links, methods=['POST'])
app.add_url_rule('/relevant/verify', 'verify_links', view_func=views.verify_links, methods=['POST'])


## Error handlers
# Handle 404 errors
@app.errorhandler(404)
def page_not_found(e):
    return render_template('404.html'), 404

# Handle 500 errors
@app.errorhandler(500)
def server_error(e):
    return render_template('500.html'), 500

