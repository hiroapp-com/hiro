# -*- coding: utf-8 -*-
from jinja2 import Template
from google.appengine.api import mail

templates = {}

templates["resetpw"] = (
"Resetting Your Hiro Password",
"""
Hi,

just visit {{url}}#reset={{token}} to reset your password.

Please let us know if there is anything else we can do,
keep capturing the good stuff.

The Hiro Team
""",
"""
<html><body>
Hi,<br /><br />
just visit <a href="{{url}}#reset={{token}}">this link</a> or open <a href="{{url}}#reset={{token}}">{{url}}#reset={{token}}</a> in a browser to reset your password.<br /><br />

Please let us know if there is anything else we can do,<br /><br />
keep capturing the good stuff.<br /><br />

The Hiro Team
</body></html>
""")


templates["invite"] = (
"{% if invited_by.name %}{{ invited_by.name }}{% else %}{{ invited_by.email }}{% endif %} {% if invitee %}Just Gave You Access to a New Note{% else %}Wants to Share a Note With You{% endif %}", 
"""
Hi,
 
{% if invited_by.name %}{{ invited_by.name }} ({{ invited_by.email }}){% else %}{{ invited_by.email }}{% endif %} just shared {{doc.title}} with you:
 
Join in anytime via {{url}}{% if not invitee %}#token={{token}}{% endif %}

Keep capturing the good stuff,
 
Team Hiro
""",
"""

<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"
   "http://www.w3.org/TR/html4/loose.dtd">

<html lang="en" style="width: 100%;text-align: center;margin: 0;padding: 0;">
<head>
	<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
	<title>{% if invited_by.name %}{{ invited_by.name }}{% else %}{{ invited_by.email }}{% endif %} {% if invitee %}Just Gave You Access to a New Note{% else %}Wants To Share A Note With You{% endif %}</title>
	<style>
	@import url(http://fonts.googleapis.com/css?family=PT+Serif|Chau+Philomene+One);
	body, html {
		width: 100%;
		text-align: center;
		margin: 0;
		padding: 0;
	}
	.content {
		width: 100%;
		max-width: 540px;
		text-align: left;
		margin: 30px auto 0 auto;
	}
	.prenote {
		color: #999999;
		font-family: 'Tahoma', sans-serif;		
		font-size: 13px;
		margin: 0 31px 0 31px;
	}	
	.note {
		background-color: #ffffff;
		border-top: 1px solid #dddddd;		
		border-right: 1px solid #dddddd;	
		border-bottom: 1px dotted #dddddd;		
		border-left: 1px solid #dddddd;			
		display: block;
		min-height: 150px;
		margin-top: 5px;
		max-height: 240px;
		overflow: hidden;
		height: 218px;
		box-shadow: 0 5px 17px -12px #000;		
	}
	a.noteheader {
		font-family: 'Chau Philomene One', sans-serif;
		font-size: 30px;
		margin: 20px 30px 0 30px;
		text-decoration:none;	
		color: #000001 !important;;	
		display: block;		
	}		
	a.notetext {
		font-family: 'PT Serif', serif;
		margin-top: 0px;
		font-size: 17px;
		line-height: 30px;
		margin: 0 30px 0 30px;
		text-decoration:none;
		color: #000001 !important;;	
		display: block;										
	}			
	.cto {
		margin: 5px 30px 3px 30px;	
		text-align: center;	
	}			
	a.ctobutton {
		font-weight: normal;
		padding: 10px 6px 9px 6px;
		height: auto;
		border-radius: 3px;
		-webkit-border-radius: 3px;
		-moz-border-radius: 3px;
		-o-border-radius: 3px;
		border: 1px solid rgba(0,0,0,0.25);
		box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);
		-webkit-box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);
		-moz-box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);
		-o-box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);
		color: rgba(255,255,255,0.95) !important;
		text-decoration: none !important;
		opacity: 0.9;
		text-shadow: none;
		display: block;
		background-image: -webkit-gradient(linear, left top, left bottom, color-stop(0%, rgba(0, 0, 0, 0)), color-stop(100%, rgba(0, 0, 0, 0.2)));
		background-image: -webkit-linear-gradient(top, transparent, rgba(0,0,0,.2));
		background-image: -moz-linear-gradient(top, transparent, rgba(0,0,0,.2));
		background-image: -ms-linear-gradient(top, transparent, rgba(0,0,0,.2));
		background-image: -o-linear-gradient(top, transparent, rgba(0,0,0,.2));
		background-image: linear-gradient(to bottom, transparent, rgba(0,0,0,0.2));
		background-color: #3c6198;
		text-align: center;
		font-family: 'Chau Philomene One', sans-serif;
		font-size: 20px;
	}	
	.postnote {
		color: #999999;
		font-family: 'Tahoma', sans-serif;		
		font-size: 13px;
		margin: 0 31px 0 31px;	
		padding-bottom: 20px;
		border-bottom: 1px dotted #dddddd;	
		display: block;
	}	
	.footer {
		color: #bbb;
		font-family: 'Tahoma', sans-serif;		
		font-size: 13px;
		margin: 0 31px 0 31px;	
		display: block;
	}				
	a.greylink {
		text-decoration: none;
		color: #333334 !important;;
	}						

	.unsubscribe {
		margin: 0 31px 0 31px;		
	}

	a.lightlink {
		text-decoration: none;
		color: #999999;
		font-family: 'Tahoma', sans-serif;		
		font-size: 13px;	
	}		
	a.lightlink:visited {
		color: #999999;
	}	
	@media only screen and (max-width: 540px) {
	  .note {
	  	border-left: none !important;
	  	border-right: none !important;
	  }
	}		
	@media only screen and (min-device-width: 541px) {
	  .content {
	   /*  width: 540px !important; */
	  }
	}	
	</style>
</head>
	<body bgcolor="#e4e4e4" topmargin="0" leftmargin="0" marginheight="0" marginwidth="0" style="-webkit-font-smoothing: antialiased;background:#fcfcfc;-webkit-text-size-adjust:none;width: 100%;text-align: center;margin: 0;padding: 0;">

	<!--[if (gte mso 9)|(IE)]>
	  <table width="540" align="center" cellpadding="0" cellspacing="0" border="0">
	    <tr>
	      <td>
	<![endif]-->
	<div class="content" style="width: 100%;max-width: 540px;text-align: left;margin: 0 auto 0 auto; padding: 30px 0 30px 0;">
		<div class="prenote" style="color: #999999;font-family: 'Tahoma', sans-serif;font-size: 13px;margin: 0 31px 0 31px;	">{% if invited_by.name %}{{ invited_by.name }} (<a href="mailto:{{ invited_by.email }}" class="lightlink" style="text-decoration: none;color: #999999;font-family: 'Tahoma', sans-serif;font-size: 13px;">{{ invited_by.email }}</a>){% else %}<a href="mailto:{{ invited_by.email }}" class="lightlink" style="text-decoration: none;color: #999999;font-family: 'Tahoma', sans-serif;font-size: 13px;">{{ invited_by.email }}</a>{% endif %} {% if invitee %}just gave you access to this note{% else %}wants you in on this{% endif %}:</div><br />
		<div class="note" style="background-color: #ffffff;border: 1px solid #dddddd;display: block;min-height: 150px;margin-top: 5px;max-height: 240px;overflow: hidden;box-shadow: 0 5px 17px -12px #000;"><br />
			<a href="{{url}}{% if not invitee %}#token={{token}}&email={% endif %}" class="noteheader" style="font-family: 'Chau Philomene One', sans-serif;font-size: 30px;margin: 0px 30px 0 30px;text-decoration:none;color: #000001 !important;display: block;">{{ doc.title }}</a><br />
			<a href="{{url}}{% if not invitee %}#token={{token}}&email={% endif %}" class="notetext" style="font-family: 'PT Serif', serif;display: block;margin-top: 0px;font-size: 17px;line-height: 30px;margin: 0 30px 0 30px;text-decoration:none;color: #000001 !important;">{{ doc.excerpt }}</a>
		</div><br /> 
		<div class="cto" style="margin: 5px 30px 3px 30px;text-align: center;"><a href="{{url}}{% if not invitee %}#token={{token}}&email={% endif %}" class="ctobutton" style="color:#ffffff;font-weight: normal;padding: 10px 6px 9px 6px;height: auto;border-radius: 3px;-webkit-border-radius: 3px;-moz-border-radius: 3px;-o-border-radius: 3px;border: 1px solid rgba(0,0,0,0.25);box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);-webkit-box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);-moz-box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);-o-box-shadow: 0px 1px 3px rgba(0,0,0,0.35), inset 0px 1px 1px rgba(255,255,255,0.30);text-decoration: none !important;opacity: 0.9;text-shadow: none;display: block;background-image: -webkit-gradient(linear, left top, left bottom, color-stop(0%, rgba(0, 0, 0, 0)), color-stop(100%, rgba(0, 0, 0, 0.2)));background-image: -webkit-linear-gradient(top, transparent, rgba(0,0,0,.2));background-image: -moz-linear-gradient(top, transparent, rgba(0,0,0,.2));background-image: -ms-linear-gradient(top, transparent, rgba(0,0,0,.2));background-image: -o-linear-gradient(top, transparent, rgba(0,0,0,.2));background-image: linear-gradient(to bottom, transparent, rgba(0,0,0,0.2));background-color: #3c6198;text-align: center;font-family: 'Chau Philomene One', sans-serif;font-size: 20px;">Join In</a></div><br />
		<div class="postnote" style="color: #999999;font-family: 'Tahoma', sans-serif;font-size: 13px;margin: 0 31px 0 31px;padding-bottom: 20px;border-bottom: 1px dotted #dddddd;display: block;">{% if invitee %}Thanks for using <a href="https://www.hiroapp.com" class="greylink" class="text-decoration: none;color: #333334 !important;">Hiro</a>, please let us know if there's anything we could do better.{% else %}{% if invited_by.name %}{{ invited_by.name }} is using {% endif %}<a href="https://www.hiroapp.com" class="greylink" class="text-decoration: none;color: #333334 !important;">Hiro</a>{% if invited_by.name %}: It's{% else %} is{% endif %} the best way to keep notes with friends & colleagues, or store them safely for yourself. Fast, simple and works on any device.{% endif %}</div><br />
		<div class="footer" style="color: #bbb;font-family: 'Tahoma', sans-serif;font-size: 13px;margin: 0 31px 0 31px;display: block;">Hiro Inc. | 1 Little W12th Street | 10014 New York </div><br />
		<div class="unsubscribe" style="margin: 0 31px 0 31px;"><a href="https://www.hiroapp.com/#dontnotify={{ to }}" class="lightlink" style="text-decoration: none;color: #999999;font-family: 'Tahoma', sans-serif;font-size: 13px;display:block;margin-bottom: 30px;">Turn off email notifications</a></div>
	</div>	
	<!--[if (gte mso 9)|(IE)]>
	      </td>
	    </tr>
	  </table>
	<![endif]-->
	</body>
</html>
""")


templates["schema"] = (
"subject", 
"""
body plain
""",
"""
body html
""")





def send_mail_tpl(tpl, to, ctx):
    subj, body, html = [Template(x.decode('utf-8')) for x in templates.get(tpl, ("", "", ""))]
    if subj == body == html == Template(""):
        raise Exception("email template {0} not found in email configuration".format(tpl))
    ctx["to"] = to
    print body.render(ctx)
    mail.send_mail("Hiro <hiro@hiroapp.com>", to, subj.render(ctx), body.render(ctx), html=html.render(ctx))
