"""
App Engine config

"""

def gae_mini_profiler_should_profile_production():
    import os
    from google.appengine.api import users
    return os.environ['SHOW_PROFILER'] == 'yes' and users.is_current_user_admin()

