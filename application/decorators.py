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
