# Preparation

Grab or set up a fresh Debian instance, install (on Debian 'apt get') 'git', 'python-pip', and 'libpg-dev' (Postgres database) if not already installed. With Python installed also add virtualenv via 'pip install virtualenv'.

Create a '/home/hiro/frontend/refs', cd to '/home/hiro/frontend', and create a virtualenv by running 'virtualenv venv'. If you want this server to run as a production system (use production keys etc) set 'HIRO_ENV' to 'live' ('export HIRO_ENV="live') and you'll also need Java installed for the YUI compresoor which automatically hashes new js/css versions.

Switch to your local machine and check out 'https://github.com/hiroapp-com/hiro.git', and make sure that you also got Python and 'fabric' running locally ('pip install fabric' or 'sudo apt install fabric'), as well as Phyton's requests framework ('pip install requests').

If everything went well, running 'fab deploy' in your local hiro directory should execute the following steps automatically:

- Dial into your server.
- Check out the latest version on the server in a '/refs' directory.
- Link everything to the latest checked out version.
- Restart server with latest revision.


Old Manual approach:


installation
  - install (on debian apt install) git, python-pip, and libpg-dev
  - $ cd /path/to/checkout
  - $ virtualenv venv
  - $ source ./venv/bin/activate
  - $ pip install -r requirements.txt
  - $ python generate_keys.py

run
  - $ HIRO_DEBUG=1 python hiro.py

 Once you are ready to deploy it as production system, make sure to set the HIRO_ENV environment variable to "live".
virtualbox