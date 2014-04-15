#!/usr/bin/env python

import sys, os


# set correct pythonpaths
if os.name == 'nt':
    # Set the absolute string on windows as quickfix
    root_dir = 'C:\local\editor'
else:
    root_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

if root_dir not in sys.path:
   sys.path.insert(0, root_dir)

lib_dir = os.path.join(root_dir, 'lib')
if lib_dir not in sys.path:
   sys.path.insert(0, lib_dir)


# imports from a path added above, hence this import's position in code
from flask.ext.assets import Environment



env_path = os.path.join(root_dir, 'static')
def assets_env(app):
    env = Environment(app)
    env.url = "/static"
    # App Engine doesn't support automatic rebuilding.
    env.auto_build = False
    # This file needs to be shipped with your code.
    env.manifest = ('file:' + os.path.join(root_dir,'webassets.manifest'))
    env.versions = 'hash:32'
    # create static bundles
    env.register('hiro_js', 'js/client.js', filters='jsmin', output="javascript/hiro.%(version)s.js")  
    env.register('hiro_css', 'css/wonderpad.css', filters='cssmin', output="stylesheets/hiro.%(version)s.css")
    env.register('new_js', 'js/hiro.js', filters='jsmin', output="javascript/hiro.%(version)s.js")      
    env.register('new_css', 'css/hiro.css', filters='cssmin', output="stylesheets/hiro.%(version)s.css")    
    if os.environ.get('SERVER_SOFTWARE', '').startswith('Devel'):
        env.debug = True
    return env

asset_html = {
    'css': '<link rel="stylesheet" type="text/css" href="{url}">',
    'js': '<script src="{url}" type="text/javascript"></script>'
    }

def get_html_output(urls):
    urls = [urls] if not hasattr(urls, '__iter__') else urls
    return '\n'.join(asset_html.get(url.split('.')[-1], '').format(url=url) for url in urls)





if __name__== "__main__":
    # gae profiler checks os.environ for gae dev server environment
    # this will trick it into thinking it is bein exec'd by de dev server

    os.environ["SERVER_SOFTWARE"] = 'Devel'

    gae_root = os.environ['GAE_ROOT']
    sys.path.append(gae_root)

    # Windows shit
    if os.name == 'nt':
        print os.environ['GAE_ROOT']        
        from _python_runtime import fix_sys_path
        fix_sys_path()  

    sys.path.append(os.path.join(gae_root, 'lib'))
    # setup flask app for context
    from flask import Flask
    app = Flask('application')
    app.config.from_object('application.settings')
    # build bundles
    env = assets_env(app)
    for bundle in list(env):
        bundle.build()
        print('built {0}'.format(bundle.output % {'version': str(bundle.get_version())}))
