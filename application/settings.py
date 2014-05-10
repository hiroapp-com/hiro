"""
settings.py

Configuration for Flask app

Important: Place your keys in the secret_keys.py module, 
           which should be kept out of version control.

"""

import os

from secret_keys import (CSRF_SECRET_KEY,
                         SESSION_KEY, 
                         FACEBOOK_APP_ID, 
                         FACEBOOK_APP_SECRET, 
                         YAHOO_CONSUMER_KEY, 
                         YAHOO_CONSUMER_SECRET,
                         STRIPE_PUBLIC_KEY,
                         STRIPE_SECRET_KEY)


DEBUG_MODE = False

# Auto-set debug mode based on App Engine dev environ
if 'SERVER_SOFTWARE' in os.environ and os.environ['SERVER_SOFTWARE'].startswith('Dev'):
    DEBUG_MODE = True
    WS_URL = 'ws://localhost:8888/0/ws'

DEBUG = DEBUG_MODE

# Set secret keys for CSRF protection
SECRET_KEY = CSRF_SECRET_KEY
CSRF_SESSION_KEY = SESSION_KEY

CSRF_ENABLED = True

# Flask-DebugToolbar settings
DEBUG_TB_PROFILER_ENABLED = DEBUG
DEBUG_TB_INTERCEPT_REDIRECTS = False


# Flask-Cache settings
CACHE_TYPE = 'gaememcached'
