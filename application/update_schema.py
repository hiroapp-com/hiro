import logging
from datetime import datetime

from .models import Document, DocAccess
from google.appengine.ext import deferred
from google.appengine.ext import ndb

BATCH_SIZE = 100  # ideal batch size may vary based on entity size.

def UpdateSchema(cursor=None, num_updated=0):
    query = Document.query()
    logging.debug('start one update run')

    nao = datetime.now()
    to_put = []
    docs, next_cursor, more = query.fetch_page(BATCH_SIZE, start_cursor=cursor)
    for doc in docs:
        #logging.debug('doc {0}'.format(doc.key.id()))
        last_changed = doc.updated_at
        if not DocAccess.query(DocAccess.doc == doc.key, DocAccess.role == 'owner', DocAccess.user == doc.owner).get():
            da, _ = DocAccess.create(doc, user=doc.owner.get(), role='owner', status='active')
            da.last_access_at = nao
            da.last_change_at = last_changed
            to_put.append(da)
        for u in doc.shared_with:
            if not DocAccess.query(DocAccess.doc == doc.key, DocAccess.role == 'collab', DocAccess.user == u).get():
                sda, _ = DocAccess.create(doc, user=u.get(), role='collab', status='active')
                sda.last_access_at = nao
                sda.last_change_at = last_changed
                to_put.append(sda)


    logging.debug('found {0} items to put'.format(len(to_put)))
    if to_put:
        ndb.put_multi(to_put)
        num_updated += len(to_put)
    if more and next_cursor:
        logging.debug('start next run')
        deferred.defer(UpdateSchema, cursor=next_cursor, num_updated=num_updated)
    else:
        logging.debug('UpdateSchema complete with %d updates!', num_updated)
        
