import logging

from .models import Document, DocAccess
from google.appengine.ext import deferred
from google.appengine.ext import ndb

BATCH_SIZE = 100  # ideal batch size may vary based on entity size.

def UpdateSchema(cursor=None, num_updated=0):
    query = Document.query()
    logging.debug('start one update run')

    to_put = []
    docs, next_cursor, more = query.fetch_page(BATCH_SIZE, start_cursor=cursor)
    for doc in docs:
        last_da = DocAccess.query(DocAccess.doc == doc.key).order(-DocAccess.last_change_at).get()
        if doc.last_update_at == last_da :
            continue
        doc.last_update_at = last_da.last_change_at
        doc.last_update_by = last_da.user

        # update access-list
        doc.access_list = [k for k in DocAccess.query(DocAccess.doc == doc.key).iter(keys_only=True)]
        to_put.append(doc)

    logging.debug('found {0} items to put'.format(len(to_put)))
    if to_put:
        ndb.put_multi(to_put)
        num_updated += len(to_put)
    if more and next_cursor:
        logging.debug('start next run')
        deferred.defer(UpdateSchema, cursor=next_cursor, num_updated=num_updated)
    else:
        logging.debug('UpdateSchema complete with %d updates!', num_updated)
        
