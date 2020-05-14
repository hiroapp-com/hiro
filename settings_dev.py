DEBUG = True

BASE_URL = 'http://localhost:5000/'
WS_URL = 'ws://localhost:8888/0/ws'
DB_PATH = 'postgres://hiro:hiro@localhost:5432/hiro?sslmode=require'

### DEV KEYS
CSRF_ENABLED = True

# CSRF- and Session keys, generated by running generate_keys.py
CSRF_SECRET_KEY = 'I4Se3ZDTp2uT3mvhhWsQQH5r'
SECRET_KEY = 'Kjhsihds88uasdoJLKJLKuansd798a7sdlkLKjlaksjd7a9sd712j34jhKHAUSdasdpsg'

SESSION_KEY = 'krsVbhJKXzMnBqoVSuZAUMyL'

# Other keys you need to add manually to your secret_keys.py file, 
# in production symlinked from /home/hiro/frontend/src/secret_keys.py

FACEBOOK_APP_ID = '<YOUR FACEBOOK APP ID>'
FACEBOOK_APP_SECRET = '<YOUR FACEBOOK APP SECRET>'

STRIPE_PUBLIC_KEY ='pk_test_YOUR STRIPE PUBLIC KEY'
STRIPE_SECRET_KEY = 'sk_test_YOUR STRIPE SECRET KEY'

INTERCOM_ID = 'YOUR INTERCOM ID';

ROLLBAR_CLIENT_TOKEN = 'YOUR ROLLBAR CLIENT TOKEN';
ROLLBAR_SERVER_TOKEN = 'YOUR ROLLBAR SERVER TOKEN';
