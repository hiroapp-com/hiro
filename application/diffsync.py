# -*- coding: utf-8 -*-
import re
import uuid 
import json
import logging
from datetime import datetime, timedelta

from google.appengine.api import memcache, channel
from diff_match_patch import diff_match_patch 
DMP = diff_match_patch()

CACHE_SESS_PREFIX = "sync-session:"
class SyncSession(dict):
    def __init__(self, *args, **kwargs):
        self['session_id'] = None
        self['user_id'] = ""
        self['shadow'] = ""
        self['last_modified'] = None
        self['client_version'] = 0
        self['server_version'] = 0
        self['backup'] = ''
        self['backup_version'] = 0
        self['edit_stack'] = []
        super(SyncSession, self).__init__(*args, **kwargs)

    def debug_state(self, doc=None, incoming_stack=None, prefix=""):
        try:
            out_stack = u";".join([u"{0[clientversion]}:{0[serverversion]}:{0[delta]}".format(d) for d in self['edit_stack']])
            logging.error(u"{prefix} cv: {self[client_version]}\t sv: {self[server_version]}\t shadow: `{self[shadow]}`\t\t backup: `{self[backup]}` \t\t editstack: {out_stack}".format(**locals()))

            if doc:
                logging.error(u"{prefix} doc.text: `{doc[text]}`".format(**locals()))
            if incoming_stack:
                in_stack = u";".join([u"{0[clientversion]}:{0[serverversion]}:{0[delta]}".format(d) for d in incoming_stack])
                logging.error(u"{prefix} incoming stack: {in_stack}".format(**locals()))
        except e:
            #make sure nuthin (encoding issues etc) will explode in the debug output
            logging.error(u"meta-debug: debug call crashed")

    @classmethod
    def gen_sessionid(cls):
        return uuid.uuid4().hex

    @classmethod
    def create(cls, text, user_id=None):
        sess = cls(user_id=user_id, shadow=text)
        sess.save()
        return sess
    
    @classmethod
    def fetch(cls, sess_id, client=None):
        client = client or memcache
        sess = client.get(CACHE_SESS_PREFIX+sess_id)
        if sess and sess['last_modified'] < (datetime.now() - timedelta(minutes=10)):
            # session expired
            client.delete(CACHE_SESS_PREFIX+sess_id)
            sess = None
        return cls(sess) if sess else None

    def save(self):
        if not self['session_id']:
            self['session_id'] = SyncSession.gen_sessionid()
        self['last_modified'] = datetime.now()
        memcache.set(CACHE_SESS_PREFIX+self['session_id'], dict(self))
        
    def push(self, msg):
        channel.send_message(self['session_id'], json.dumps(msg))

    def sync_inbound(self, stack, doc):
        """ Apply (inplace) `stack` of edits onto `self` for `doc` and return if text was changed(bool)"""
        # WARN: `session` and `doc` will be modified inplace
        ok = True
        changed = False
        mastertext, shadow = doc['text'], self['shadow']
        for edit in stack:
            sv, cv, delta = edit['serverversion'], edit['clientversion'], edit['delta']

            # if server-ACK lost, rollback to backup
            if sv != self['server_version'] and sv == self['backup_version']:
                print "SV MISMATCH: RECOVERING FROM BACKUP"
                self.debug_state(incoming_stack=stack)
                shadow = self['backup']
                self['server_version'] = self['backup_version']
                self['edit_stack'] = []

            # clear client-ACK'd edits from server stack
            self['edit_stack'] = [e for e in self['edit_stack'] if e['serverversion'] > sv]

            # start the delta-fun!
            if sv != self['server_version']:
                # version mismatch
                #request re-sync
                logging.error("SV MISMATCH - resync")
                self.debug_state(doc=doc, incoming_stack=stack)
                ok = False
            elif cv > self['client_version']:
                # client in the future?
                #request re-sync
                logging.error("CV MISMATCH - resync")
                self.debug_state(incoming_stack=stack)
                ok = False
            elif cv < self['client_version']:
                # dupe
                pass
            else:
                try:
                    diffs = DMP.diff_fromDelta(shadow, delta)
                    if len(diffs) > 1 or (len(diffs) == 1 and diffs[0][0] != DMP.DIFF_EQUAL):
                        changed = True
                except ValueError, e:
                    #request re-sync
                    diffs = None
                    ok = False
                    logging.error("==================== COULD NOT MERGE - resync, state: ")
                    self.debug_state(doc=doc, incoming_stack=stack)
                self['client_version'] += 1
                if diffs:
                    # patch master-doc
                    patches = DMP.patch_make(shadow, diffs)
                    shadow = DMP.diff_text2(diffs)
                    self['backup'] = shadow
                    self['backup_version'] = self['server_version']
                    mastertext, res = DMP.patch_apply(patches, mastertext)
                    mastertext = re.sub(r"(\r\n|\r|\n)", "\n", mastertext)

        # render output
        if ok:
            diffs = DMP.diff_main(shadow, mastertext)
            DMP.diff_cleanupEfficiency(diffs)
            delta = DMP.diff_toDelta(diffs)
            self['edit_stack'].append({'serverversion': self['server_version'],
                                       'clientversion': self['client_version'],
                                       'delta': delta,
                                       'force': False
                                       })
            self['server_version'] += 1
            doc['text'] = mastertext
            
        else:
            self['client_version'] += 1
            self['edit_stack'].append({'serverversion': self['server_version'],
                                       'clientversion': self['client_version'],
                                       'delta': mastertext,
                                       'force': True
                                       })
        self['shadow'] = mastertext
        self['last_modified'] = datetime.now()
        return changed
