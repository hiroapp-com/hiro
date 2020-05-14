# Preparation

Grab or set up a fresh Debian instance, install (on Debian 'apt get') 'git', 'python-pip', and 'libpg-dev' (Postgres database) if not already installed. With Python installed also add virtualenv via 'pip install virtualenv'.

Create a '/home/hiro/frontend/refs', cd to '/home/hiro/frontend', and create a virtualenv by running 'virtualenv venv'. If you want this server to run as a production system (use production keys etc) set 'HIRO_ENV' to 'live' ('export HIRO_ENV="live') and you'll also need Java installed for the YUI compressor which automatically hashes new js/css versions.

Switch to your local machine and check out 'https://github.com/hiroapp-com/hiro.git', and make sure that you also got Python and 'fabric' running locally ('pip install fabric' or 'sudo apt install fabric'), as well as Phyton's requests framework ('pip install requests').

Next up run 'generate_keys.py' locally to generate necessary CSRF and session keys locally, add the necessary tokens as needed from 'setting_dev.py' (or 'live'), then generate a '/etc' folder on your server's Hiro root (default is '/home/hiro/frontend') und put the 'secret_keys.py' file there (when you deploy, the script will symlink to this permanent version).

If everything went well, running 'fab deploy' in your local hiro directory should execute the following steps automatically:

- Dial into your server.
- Check out the latest version on the server in a '/refs' directory.
- Link everything to the latest checked out version.
- Restart server with latest revision.

If everything went smoothly, go to your server's Hiro current directory at '/home/hiro/frontend/current' and run uwsgi via:

'uwsgi --http :80 --wsgi-file hiro.py --callable app --touch-reload /home/hiro/frontend/run/reload --virtualenv /home/hiro/frontend/venv/'

The second to last parameter tells uWSGI to automatically reload when the deploy script touches the empty 'run/reload' file, and 'venv' is optional depending on yopur local setup.

TODO: Add nginx docu and settings