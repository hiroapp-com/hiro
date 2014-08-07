# jsonclient.py
# Simple JSONRPC client library created to work with Go servers
# Works with both Python 2.6+ and Python 3
# Copyright (c) 2011 Stephen Day, Bruce Eckel
# Distributed under the MIT Open-Source License:
# http://www.opensource.org/licenses/MIT
# via http://www.artima.com/weblogs/viewpost.jsp?thread=333589
import json, socket, itertools

class JSONClient(object):

    def __init__(self, addr):
        self.addr = addr
        self.id_counter = itertools.count()
        try:
            self.socket = socket.create_connection(addr)
        except:
            self.socket = None

    def __del__(self):
        if not self.socket:
            return
        self.socket.close()

    def connect(self):
        if self.socket:
            return True
        try:
            self.socket = socket.create_connection(self.addr)
            return True
        except socket.error as msg: 
            print "connection to comm listener at {} failed with msg {}".format(self.addr, msg)
            self.socket = None
            return False

    def call(self, name, retry=1, *params):
        if not self.connect():
            return None
        request = dict(id=next(self.id_counter),
                    params=list(params),
                    method=name)
        self.socket.sendall(json.dumps(request).encode())

        # This must loop if resp is bigger than 4K
        response = self.socket.recv(4096)
        if len(response) == 0:
            # send failed even after connect. something most be wrong
            # save send-request somewhere for later resend
            self.socket = None
            if retry > 0:
                return self.call(name, (retry-1), *params)
            return None
        response = json.loads(response.decode())

        if response.get('id') != request.get('id'):
            raise Exception("expected id=%s, received id=%s: %s"
                            %(request.get('id'), response.get('id'),
                              response.get('error')))

        if response.get('error') is not None:
            raise Exception(response.get('error'))

        return response.get('result')
