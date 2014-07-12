"""
settings.py

Configuration for Flask app

Important: Place your keys in the secret_keys.py module, 
           which should be kept out of version control.

"""

import os

from secret_keys import (CSRF_SECRET_KEY,
                         SESSION_KEY, 
                         STRIPE_PUBLIC_KEY,
                         STRIPE_SECRET_KEY,
                         FACEBOOK_APP_SECRET,
                         FACEBOOK_APP_ID)




DEBUG = (os.environ.get('HIRO_DEBUG'))

WS_URL = 'ws://localhost:8888/0/ws'
# Set secret keys for CSRF protection
SECRET_KEY = CSRF_SECRET_KEY
CSRF_SESSION_KEY = SESSION_KEY

CSRF_ENABLED = True
