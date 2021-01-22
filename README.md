Consumer Usage guide:

1. Subscribe to a token and upload the script file:

_curl -F &#39;jsscript=@./test.js&#39;_ [_http://localhost:8090/uploadJSScript?token=study.745_](http://localhost:8090/uploadJSScript?token=study.745)

_curl -F &#39;pyscript=@./test.py&#39; http://localhost:8090/uploadPYScript?token=study.745_

Here localhost:8090 is the address for the consumer server and you need to replace it with the correct address.

Where test.js is your script file you want to upload and is in the same directory form where you are running this curl command, token parameter is the token for which you want to listen the data.

For eg: if you want to listen data for all the studies and for all activities the toke should be in this format: study.\*.activity.\*

If you want to listen data for all the activities of the studyID 123 then the token will be : study.123.activity.\*

This API will give you a unique secret file path to which your script was uploaded, you need to save it in case you need to update your script or unsubscribe your script in future you will need this secret file path.

Given below are the Automation engine API details and token details to which the consumer listens to:

1.http://localhost:3000/listen/researcher?researcher\_id=1234

Token = researcher.\* data for all the researchers added/updated/deleted

Token = researcher.1234 data for researcher id 1234

2.http://localhost:3000/listen/researcher/study?researcherId=1234&amp;studyId=123

Token = researcher.1234.study.\* data for researcher id 1234 and any his/her study added/edited/deleted

Token = researcher.\*.study.\*. data for all the researcher and their study added/updated/deleted

Token = researcher.123.study.345 data for researcher Id 123 and his study id 345

3. http://localhost:3000/listen/study/activity/?study\_id=1234&amp;activity\_id=123

Token = study.1234.activity.\* data for study id 1234 and any of its activity added/edited/deleted

Token = study.\*.activity.\*. data for all the studies and their activities added/updated/deleted

Token = study.123.activity.345 data for study Id 123 and its activity id 345

4. http://localhost:3000/listen/study/participant/?study\_id=1234&amp;participant\_id=123

Token = study.1234.participant.\* data for study id 1234 and any its participant added/edited/deleted

Token = study.\*.participant.\*. data for all the studies and its participant added/updated/deleted

Token = study.123.participant.345 data for study Id 123 and its participant id 345

5. http://localhost:3000/listen/study/sensor/?study\_id=1234&amp;sensor\_id=123

Token = study.1234.sensor.\* data for study id 1234 and any its sensor added/edited/deleted

Token = study.\*.sensor.\*. data for all the studies and its sensor added/updated/deleted

Token = study.123.sensor.345 data for study Id 123 and its sensor id 345

6. http://localhost:3000/listen/participant/activity\_event/?participant\_id=1234&amp;activity\_id=123

Token= activity\_event.\* all activity\_events

Token= activity.456.activity\_event.\* all activity\_events for an activity

Token= participant.555.activity\_event.\* all activity\_events for a particpant

Token= participant.555.activity.456.activity\_event.\* all activity\_events under a participant and for an activity

7. http://localhost:3000/listen/participant/sensor\_event/?participant\_id=1234&amp;sensor=gyroscope

Token= sensor\_event.\* all sensor\_events

Token= sensor.gyroscope.sensor\_event.\* all sensor\_events for a sensor

Token= participant.555.activity\_event.\* all sensor\_events for a particpant

Token= participant.555.sensor.gyroscope.sensor\_event.\* all sensor\_events under a participant and for a sensor

1. Update the previously uploaded script:

_curl -F &#39;jsscript=@./test.js&#39; http://localhost:8090/updateScript?secretpath=1kWCcnwXblzwoFR5S01Shkxh62W\_test.js_

Here the test.js is the new script you want to update to and secretpath is the value that you received when you uploaded your original script.

1. Unsubscribe the script:


_curl -X &quot;DELETE&quot; &quot;http://localhost:8090/unsubscribe?secretpath=1kWCcnwXblzwoFR5S01Shkxh62W\_test.js &amp;token=study.745_