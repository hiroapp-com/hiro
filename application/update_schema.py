import logging

from .models import User, Document, DocAccess
from google.appengine.ext import deferred
from google.appengine.ext import ndb

BATCH_SIZE = 1000  # ideal batch size may vary based on entity size.

def UpdateSchema(cursor=None, num_updated=0):
    query = User.query()
    logging.debug('start one update run')

    to_put = []
    ents, next_cursor, more = query.fetch_page(BATCH_SIZE, start_cursor=cursor)
    for ent in ents:
        put = False
        if 'docs_seen' in ent._properties:
            del ent._properties['docs_seen']
            put = True
        if put:
            to_put.append(ent)
        #doc.sticky = doc.json_sticky 
        #doc.blacklist = doc.json_blacklist 
        #doc.cached_ser = doc.json_cached_ser 
        #to_put.append(doc)

    logging.debug('found {0} items to put'.format(len(to_put)))
    if to_put:
        ndb.put_multi(to_put)
        num_updated += len(to_put)
    if more and next_cursor:
        logging.debug('start next run')
        deferred.defer(UpdateSchema, cursor=next_cursor, num_updated=num_updated)
    else:
        logging.debug('UpdateSchema complete with %d updates!', num_updated)
        
