
# installation
  - install (on debian apt install) git, python-pip, and libpg-dev
  - $ cd /path/to/checkout
  - $ virtualenv venv
  - $ source ./venv/bin/activate
  - $ pip install -r requirements.txt
  - $ python generate_keys.py
  - $ HIRO_DEBUG=1 python hiro.py
