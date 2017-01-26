'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('node-uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');

const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG || 'en';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;

const apiAiService = apiai(APIAI_ACCESS_TOKEN, {language: APIAI_LANG, requestSource: "fb"});
const sessionIds = new Map();

function processEvent(event) {
    var sender = event.sender.id.toString();

    if ((event.message && event.message.text) || (event.postback && event.postback.payload)) {
        var text = event.message ? event.message.text : event.postback.payload;
        // Handle a text message from this sender

        if (!sessionIds.has(sender)) {
            sessionIds.set(sender, uuid.v1());
        }

        console.log("Text", text);

        let apiaiRequest = apiAiService.textRequest(text,
            {
                sessionId: sessionIds.get(sender)
            });

       apiaiRequest.on('response', (response) => {
          
            if (isDefined(response.result)) {
                let responseText = response.result.fulfillment.speech;
                let responseData = response.result.fulfillment.data;
                let action = response.result.action;

                if (isDefined(responseData) && isDefined(responseData.facebook)) {
                  console.log(responseData.facebook);
                    if (!Array.isArray(responseData.facebook)) {
                        try {
                            console.log('Response as formatted message');
                            sendFBMessage(sender, responseData.facebook);
                        } catch (err) {
                            sendFBMessage(sender, {text: err.message});
                        }
                    } else {
                       /* responseData.facebook.forEach((facebookMessage) => {
                            
                        });*/
                        sendFbData(sender,responseData.facebook,0)
                    }
                } else if (isDefined(responseText)) {
                    console.log('Response as text message');
                    // facebook API limit for text length is 320,
                    // so we must split message if needed
                    var splittedText = splitResponse(responseText);

                    async.eachSeries(splittedText, (textPart, callback) => {
                        sendFBMessage(sender, {text: textPart}, callback);
                    });
                }

            }
        });

        apiaiRequest.on('error', (error) => console.error(error));
        apiaiRequest.end();
    }
}

function sendLoop(sender,facebookMessage,x,callback){
                                      
                                      sendFBMessage(sender, facebookMessage[x],function(){
                                        x++;
                                        if(x<facebookMessage.length){
                                          sendLoop(sender,facebookMessage,x);
                                        }else{
                                          
                              if(callback){           
                                      callback();
                                        }
                                          
                                        }
                                        
                                      });
                                      
                               }
                               
                              
 function sendFbData(sender,facebookData,x){
   
   try {
                                if (facebookData[x].sender_action) {
                                    console.log('Response as sender action');
                                    sendFBSenderAction(sender, facebookData[x].sender_action,function(){
                                       x++;
                                        if(x<facebookData.length){
                                          sendFbData(sender,facebookData,x);
                                        }else{
                                          
                                          return true;
                                        }
                                    });
                                }
                                else {
                                  
                                     /* facebookMessage.forEach((message)=>{
                                          console.log('Response as formatted message'+(message.text));
                                    sendFBMessage(sender, message);
                                      });*/
                                      
                                      console.log("sdfsdf"+facebookData[x].length);
                                      sendLoop(sender,facebookData[x],0,function(){
                                       x++;
                                        if(x<facebookData.length){
                                          sendFbData(sender,facebookData,x);
                                        }else{
                                          
                                          return true;
                                        }
                                    });
   
                                }
                            } catch (err) {
                                sendFBMessage(sender, {text: err.message});
                            }
   
   
 }                              
                               
function splitResponse(str) {
    if (str.length <= 320) {
        return [str];
    }

    return chunkString(str, 300);
}

function chunkString(s, len) {
    var curr = len, prev = 0;

    var output = [];

    while (s[curr]) {
        if (s[curr++] == ' ') {
            output.push(s.substring(prev, curr));
            prev = curr;
            curr += len;
        }
        else {
            var currReverse = curr;
            do {
                if (s.substring(currReverse - 1, currReverse) == ' ') {
                    output.push(s.substring(prev, currReverse));
                    prev = currReverse;
                    curr = currReverse + len;
                    break;
                }
                currReverse--;
            } while (currReverse > prev)
        }
    }
    output.push(s.substr(prev));
    return output;
}

function sendFBMessage(sender, messageData, callback) {
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            message: messageData
        }
    }, (error, response, body) => {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        } else if(response){
         // console.log("haisdds"+response);
           if (callback) {
            callback();
           }
        }

       
    });
}

function sendFBSenderAction(sender, action, callback) {
    setTimeout(() => {
        request({
            url: 'https://graph.facebook.com/v2.6/me/messages',
            qs: {access_token: FB_PAGE_ACCESS_TOKEN},
            method: 'POST',
            json: {
                recipient: {id: sender},
                sender_action: action
            }
        }, (error, response, body) => {
            if (error) {
                console.log('Error sending action: ', error);
            } else if (response.body.error) {
                console.log('Error: ', response.body.error);
            } else if(response){
            if (callback) {
                callback();
            }
            }
        });
    }, 1000);
}

function doSubscribeRequest() {
    request({
            method: 'POST',
            uri: "https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while subscription: ', error);
            } else {
                console.log('Subscription result: ', response.body);
            }
        });
}

function addGetStartedButton(){
   request({
            method: 'POST',
            json: {
                    "setting_type":"call_to_actions",
                    "thread_state":"new_thread",
                    "call_to_actions":[
                      {
                        "payload":"GETTING_STARTED_BUS"
                      }
                    ]
        },
            uri: "https://graph.facebook.com/v2.6/me/thread_settings?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while configuring getting started: ', error);
            } else {
                console.log('Getting started configured: ', response.body);
            }
        });
}

function addPersistentMenu(){
  
   request({
            method: 'POST',
            "Content-Type": 'application/json',
             json: {
                    "setting_type" : "call_to_actions",
                  "thread_state" : "existing_thread",
                  "call_to_actions":[
                    
                    {
                      "type":"postback",
                      "title":"From Adibatla",
                      "payload":"FROMADIBATLA"
                    },
                    {
                      "type":"postback",
                      "title":"To Adibatla",
                      "payload":"TOADIBATLA"
                    },
	                   {
              "type": "web_url",
              "url": "www.adibatlatransportation.com",
              "title": "click to visit the site"
                     }
                   
                  ]
                  },
            uri: "https://graph.facebook.com/v2.6/me/thread_settings?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while configuring PersistentMenu: ', error);
            } else {
                console.log('PersistentMenu configured: ', response.body);
            }
        });
  

}


function addGreetingText(){
   request({
            method: 'POST',
            json: {
                    "setting_type":"greeting",
                   "greeting":{
    "text":"Hi {{user_first_name}}, welcome to Adibatla Transportation Bot."
  }
        },
            uri: "https://graph.facebook.com/v2.6/me/thread_settings?access_token=" + FB_PAGE_ACCESS_TOKEN
        },
        (error, response, body) => {
            if (error) {
                console.error('Error while setting greetings: ', error);
            } else {
                console.log('Setting Greetings: ', response.body);
            }
        });
}
	
//
	function sendFBImage(sender, imageUrl, callback){
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            "message":{
                "attachment":{
                    "type":"image",
                    "payload":{
                        "url": imageUrl
                    }
                }
            }
        }
    }, function (error, response, body) {
        if (error) {
            console.log('Error sending image: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }

        if (callback) {
            callback();
        }
    });
}
	//
	
	//-----------------------------
	
	function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", 
    senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var messageId = message.mid;

  var messageText = message.text;
  var messageAttachments = message.attachments;

  if (messageText) {

    // If we receive a text message, check to see if it matches a keyword
    // and send back the example. Otherwise, just echo the text we received.
    switch (messageText) {
      case 'generic':
        sendGenericMessage(senderID);
        break;

      default:
        sendTextMessage(senderID, messageText);
    }
  } else if (messageAttachments) {
    sendTextMessage(senderID, "Message with attachment received");
  }
	
	function sendGenericMessage(recipientId) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title: "rift",
            subtitle: "Next-generation virtual reality",
            item_url: "https://www.oculus.com/en-us/rift/",               
            image_url: "http://messengerdemo.parseapp.com/img/rift.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/rift/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for first bubble",
            }],
          }, {
            title: "touch",
            subtitle: "Your Hands, Now in VR",
            item_url: "https://www.oculus.com/en-us/touch/",               
            image_url: "http://messengerdemo.parseapp.com/img/touch.png",
            buttons: [{
              type: "web_url",
              url: "https://www.oculus.com/en-us/touch/",
              title: "Open Web URL"
            }, {
              type: "postback",
              title: "Call Postback",
              payload: "Payload for second bubble",
            }]
          }]
        }
      }
    }
  };  

  callSendAPI(messageData);
}
	
	//---------------------------------------------
	
	
	
function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

const app = express();

app.use(bodyParser.text({type: 'application/json'}));

app.get('/webhook/', (req, res) => {
//console.log(req);
    if (req.query['hub.verify_token'] == FB_VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);

        setTimeout(() => {
            doSubscribeRequest();
        }, 3000);
    } else {
        res.send('Error, wrong validation token');
    }
});

app.post('/webhook/', (req, res) => {
    try {
        console.log(req.body);
        var data = JSONbig.parse(req.body);

        if (data.entry) {
            let entries = data.entry;
            entries.forEach((entry) => {
                let messaging_events = entry.messaging;
                if (messaging_events) {
                    messaging_events.forEach((event) => {
                        if (event.message && !event.message.is_echo ||
                            event.postback && event.postback.payload) {
                            processEvent(event);
                        }
                    });
                }
            });
        }

        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }

});

app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});

doSubscribeRequest();
addGetStartedButton();
addPersistentMenu();
addGreetingText();

