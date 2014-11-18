import os
import json
import tempfile

import requests
from fabric.tasks import execute
from fabric.utils import abort
from fabric.colors import green
from fabric.api import run, cd, env, task, roles, local
from fabric.network import ssh

ssh.util.log_to_file('fuuuuu.log', 10)


if os.name == 'nt':
    env.key_filename = 'C:\Users\\bruno.haid\.ssh\hirobeta_rsa'

env.user = 'hiro'
env.use_ssh_config = True
env.roledefs = {
        'frontend': ['beta.hiroapp.com', ],
        }

REPO_URL = 'git@bitbucket.org:sushimako/hiro.git'

ROOT         = '/home/hiro/frontend'
RELOAD_FILE  = '/home/hiro/frontend/run/reload'
DB_PATH      = '/home/hiro/db/hiro.db'


# root: /home/hiro/frontend
# /venv         -> virtualenv
# /current      -> (symlink) currently active ref
# /refs/<hash>  -> (dir) a shallow checkout of given ref
# /run/reload   -> (file) empty file being watched by uwsgi. if touched, uwsgi reloads itself

# (1) checkout current version at /refs/<hash>
# (2) make sure venv is uptodate
# (3) symlink config files
# (4) rebuild staticfiles
# (5) change current symlink
# (6) trigger reload

@task
@roles('frontend')
def checkout(branch='master'):
    with cd(ROOT + '/refs'):
        tmpdir = tempfile.mkdtemp(prefix='.clone-', dir='.')
        run('git clone --depth 1 --branch {0} {1} {2}'.format(branch, REPO_URL, tmpdir))
        ref = run('git --git-dir={0} rev-parse --short HEAD'.format(tmpdir + '/.git'))
        if 'path_exists' == run('[ -d {0} ] && echo "path_exists" || echo "Path clear"'.format(ref)):
            abort("Curent revision is already checked out. Aborting")
        run('mv {0} {1}'.format(tmpdir, ref))
        print(green('{0}: checkout successful'.format(ref)))
        return ref


@task
@roles('frontend')
def prepare(ref):
    # make sure venv is up to date
    with cd(ROOT):
        run('source venv/bin/activate && pip install --upgrade --requirement={0}'.format(ROOT + '/refs/' + ref + '/requirements.txt'))
        print(green('{0}: venv uptodate'.format(ref)))
    # symlink config files and db into place
    with cd(ROOT + '/refs/' + ref):
        run('ln -snf {0} .'.format(ROOT + '/etc' + '/secret_keys.py'))
        # TODO: remove next line after switch to pgsql
        run('ln -snf {0} .'.format(DB_PATH))
        print(green('{0}: installed db and config files'.format(ref)))


@task
@roles('frontend')
def rebuild_assets(ref):
    with cd(ROOT + '/refs/' + ref):
        run('source {0} && ./assets.py'.format(ROOT + '/venv/bin/activate'))
        print(green('{0}: assets rebuilt'.format(ref)))

@task 
@roles('frontend')
def write_versionfile(ref): 
    version = run(r'git ls-remote --tags {0} | grep -v "\^{{}}" | cut -d "/" -f 3 | sort -V | tail -1'.format(REPO_URL))
    version_json = json.dumps({'version': '-'.join((version, ref))})
    version_file = ROOT + '/refs/' + ref + '/version'
    run("echo '{0}' > {1}".format(version_json, version_file))



@task 
@roles('frontend')
def activate(ref):
    with cd(ROOT):
        run('ln -snf {0} current'.format('refs/' + ref))
        execute(reload_uwsgi)
        print(green('{0}: activated, now serving this version'.format(ref)))


@task 
@roles('frontend')
def reload_uwsgi():
    run('touch {0}'.format(RELOAD_FILE))
    print(green('WSGI server reloaded'))

def rollbar_record_deploy(ref):
    access_token = 'e04e617c41a14e70a7f94ab184fdca61'
    environment = 'beta'
    local_username = local('whoami', capture=True)
    # fetch last committed revision in the locally-checked out branch

    resp = requests.post('https://api.rollbar.com/api/1/deploy/', {
        'access_token': access_token,
        'environment': environment,
        'local_username': local_username,
        'revision': ref
    }, timeout=3)

    if resp.status_code == 200:
        print "Deploy recorded successfully."
    else:
        print "Error recording deploy:", resp.text

            

@task
@roles('frontend')
def deploy():
    result = execute(checkout)
    ref = result.values()[0]
    execute(prepare, ref)
    execute(rebuild_assets, ref)
    execute(write_versionfile, ref)
    execute(activate, ref)
    execute(rollbar_record_deploy, ref)
    print(green('deploymet of HEAD finished'))
