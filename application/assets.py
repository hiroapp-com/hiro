#!/usr/bin/env python

import sys, os


# set correct pythonpaths
root_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
if root_dir not in sys.path:
   sys.path.insert(0, root_dir)

lib_dir = os.path.join(root_dir, 'lib')
if lib_dir not in sys.path:
   sys.path.insert(0, lib_dir)


# imports from a path added above, hence this import's position in code
from flask.ext.assets import Environment

# gae profiler checks os.environ for gae dev server environment
# this will trick it into thinking it is bein exec'd by de dev server
os.environ["SERVER_SOFTWARE"] = 'Devel'


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
    env.register('hiro_js', 'js/client.js', output="javascript/hiro.%(version)s.js")
    env.register('hiro_css', 'css/wonderpad.css', output="stylesheets/hiro.%(version)s.css")
    return env


if __name__== "__main__":
    gae_root = os.environ['GAE_ROOT']
    sys.path.append(gae_root)
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
