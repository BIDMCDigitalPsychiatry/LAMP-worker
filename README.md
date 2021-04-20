# LAMP Worker

1) Subscribe to a token and upload the script file:
API:/consumer/subscribe @POST
BODY:{
scriptfile:file
token:string
}
RESPONSE:{
  identifier?: string
  token?: string
  subscribed: boolean
}
The zip file which is to be uploaded should contain:
-script file (this can be .js or .py file)
-requirements.txt(comma separated, if multiple comes)
-version.txt(not mandatory, it can be generally used with python script, as python3 and python2 may have some difference in running the scripts. This file can contain a single string called 'python3' or 
'python2'). The default python version would be 'python3'

All the possible tokens which can be subscribed:
a)Researcher :
researcher.*
researcher.1234
b) Study :
researcher.*.study.*
researcher.1234.study.*
researcher.123.study.345
c)Activity :
study.*.activity.*
researcher.1234.study.*
researcher.123.study.345
d)Participant:   
study.*.participant.*
study.1234.participant.*
study.123.participant.345
d)Sensor:   
study.*.sensor.*
study.1234.sensor.*
study.123.sensor.345
e)Activity_Event:   
activity.*.participant.* 
activity.123.participant.* 
activity.*.participant.456 
activity.123.participant.456 

               
 
2) Unsubscribe the script file for a token:
API:/consumer/unsubscribe @POST
BODY:{
identifier:string
token:string
}
RESPONSE:{
  identifier?: string
  token?: string
  subscribed: boolean
}
 
DOCKER IMAGE DETAILS :
The docker image required is ubuntu:latest with packages mentioned below:
python2
python3
pip2
pip3
nodejs
npm