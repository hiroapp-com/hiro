from google.appengine.api import mail

templates = {}

templates["resetpw"] = (
"Resetting your Hiro password",
"""
Hi,
just visit {url}#reset={token} to reset your password.

Please let us know if there is anything else we can do,
keep capturing the good stuff.

The Hiro Team
""",
"""
<html><body>
Hi,
just visit {url}#reset={token} to reset your password.

Please let us know if there is anything else we can do,
keep capturing the good stuff.

The Hiro Team
</body></html>
""")


templates["invite"] = (
"New Note!", 
"""
<html><body>
{sender} shared a note with you, yiiha!

Go to {url}#token={token}!

The Hiro Team
""",
"""
{sender} shared a note with you, yiiha!

Go to {url}#token={token}!

The Hiro Team
</body></html>
""")


templates["schema"] = (
"subject", 
"""
body plain
""",
"""
body html
""")





def send_mail_tpl(tpl, to, context):
    subj, body, html = templates.get(tpl, (None, None, None))
    if subj == body == html == None:
        raise Exception("email template {0} not found in email configuration".format(tpl))
    mail.send_mail("Team Hiro <hello@hiroapp.com>", to, subj, body.format(**context), html=html.format(**context))
