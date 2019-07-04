

# SmartNetConf.wsgi 
import sys 
#Expand Python classes path with your app's path 
sys.path.insert(0, "/var/www/SmartNetConf") 
sys.path.append("/var/www/SmartNetConf/venv3/lib/python3.6/site-packages/")

from SmartNetConf import app 
from SmartNetConf import app as application

#Put logging code (and imports) here ... 
#Initialize WSGI app object 
application = app


