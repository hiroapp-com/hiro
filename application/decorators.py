"""
decorators.py

Decorators for URL handlers

"""

from functools import wraps
from flask.ext.login import current_user


def limit_free_plans(func):
    @wraps(func)
    def decorated_view(*args, **kwargs):
        current_user.usage_ctr += 1
        if current_user.usage_ctr <= current_user.usage_quota:
            return func(*args, **kwargs)
        else:
            return '', 402
    return decorated_view

def root_required(func):
    @wraps(func)
    def decorated_view(*args, **kwargs):
        if not current_user.has_root:
            return 'you shall not pass', 403
        else:
            return func(*args, **kwargs)
    return decorated_view

