# Preparation

Grab or set up a fresh Debian instance, install (on Debian 'apt get') 'git', 'python-pip', and 'libpg-dev' (Postgres database) if not already installed. With Python installed also add virtualenv via 'pip install virtualenv'.

Checkout 'https://github.com/hiroapp-com/hiro.git' to your local machine, and make sure that you also got Python and 'fabric' running locally ('pip install fabric') .

With the server ready, check that the beginning of 'fabfile.py' is in line with how you want to connect to it, and then run 'fab deploy' on your local machine.

From here on out Fabric should run the following steps automatically:

- Dial into your server.
- Check out the latest version on the server in a '/refs' directory
- Link everything to the latest checked out version
- Restart server with latest revision


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
