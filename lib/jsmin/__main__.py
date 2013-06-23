import sys, os

sys.path.append(os.getcwd())
from . import JavascriptMinify

with open(sys.argv[1], 'r') as js:
    minifier = JavascriptMinify(js, sys.stdout)
    minifier.minify()
    
    
