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
                //asd
                let responseText = response.result.fulfillment.speech;
                let responseData = response.result.fulfillment.data;
                let action = response.result.action;
                if (isDefined(responseData) && isDefined(responseData.facebook)) {
                    if (!Array.isArray(responseData.facebook)) {
                        try {
                            console.log('Response as formatted message');
                            sendFBMessage(sender, responseData.facebook);
                        } catch (err) {
                            sendFBMessage(sender, {text: err.message});
                        }
                    } else {
                        responseData.facebook.forEach((facebookMessage) => {
                            try {
                                if (facebookMessage.sender_action) {
                                    console.log('Response as sender action');
                                    sendFBSenderAction(sender, facebookMessage.sender_action);
                                }
                                else {
                                    console.log('Response as formatted message');
                                    sendFBMessage(sender, facebookMessage);
                                }
                            } catch (err) {
                                sendFBMessage(sender, {text: err.message});
                            }
                        });
                    }
                    //} else if (isDefined(responseText)) {
                } else if (isDefined(action) && isDefined(responseText)) {
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
    //console.log(output);
    //output = ['Length of param message[text] must be less than or equal to 320'];
    return output;
}

function sendFBMessage(sender, messageData, callback) {
    //console.log(sender);
    request({
        url: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {access_token: FB_PAGE_ACCESS_TOKEN},
        method: 'POST',
        json: {
            recipient: {id: sender},
            message: messageData
            //message: generic_message
        }
    }, (error, response, body) => {
        if (error) {
            console.log('Error sending message: ', error);
        } else if (response.body.error) {
            console.log('Error: ', response.body.error);
        }

        if (callback) {
            callback();
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
            }
            if (callback) {
                callback();
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
        var data = JSONbig.parse(req.body);
        var asd = data;
        //console.log(asd);
        if (data.entry) {
            let entries = data.entry;
            entries.forEach((entry) => {
                let messaging_events = entry.messaging;
                if (messaging_events) {
                    messaging_events.forEach((event) => {
                        //console.log(event);
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

app.post('/webhook_apiai/', (req, res) => {

    //setting variable for custom intent checkk
    var weather_query = false;

    //creating custom fb formated message template
    const generic_message = {
        attachment: {
            type: "template",
            payload: {
                template_type: "generic",
                elements: []
            }
        }
    };

    //creating custom payload elements template for pizza webhook example
    var HAWAIIAN_CHICKEN = {
        "data': {
        "facebook": [
        {
        title: "HAWAIIAN CHICKEN",
        subtitle: "Chicken meat, juicy pineapples and Mozzarella cheese on tomato pizza sauce.",
        item_url: "https://en.wikipedia.org/wiki/Pizza",
        image_url: "http://www.phdelivery.com.my/i/menu/pizza/pizza_hawaiianchicken.jpg",
        buttons: [/*{
         type: "web_url",
         url: "https://en.wikipedia.org/wiki/Pizza",
         title: "Open Web URL"
         },*/ {
            type: "postback",
            title: "Show HAWAIIAN CHICKEN",
            payload: "HAWAIIAN CHICKEN"
        }]
}
        ]}
    };
    var CHICKEN_PEPPERONI = {
        title: "CHICKEN PEPPERONI",
        subtitle: "Chicken pepperoni topped with mozzarella cheese and tomato pizza sauce.",
        item_url: "https://en.wikipedia.org/wiki/Pizza",
        image_url: "http://www.phdelivery.com.my/i/menu/pizza/pizza_chickenpepperoni.jpg",
        buttons: [/*{
         type: "web_url",
         url: "https://en.wikipedia.org/wiki/Pizza",
         title: "Open Web URL"
         },*/ {
            type: "postback",
            title: "Show CHICKEN PEPPERONI",
            payload: "CHICKEN PEPPERONI"
        }]
    };
    var TROPICAL_CHICKEN = {
        title: "TROPICAL CHICKEN",
        subtitle: "Sliced chicken rolls and pineapples accompanied by tomato pizza sauce.",
        item_url: "https://en.wikipedia.org/wiki/Pizza",
        image_url: "http://www.phdelivery.com.my/i/menu/pizza/pizza_tropicalchicken.jpg",
        buttons: [/*{
         type: "web_url",
         url: "https://en.wikipedia.org/wiki/Pizza",
         title: "Open Web URL"
         },*/ {
            type: "postback",
            title: "Show TROPICAL CHICKEN",
            payload: "TROPICAL CHICKEN"
        }]
    };
    var SPICY_TUNA = {
        title: "SPICY TUNA",
        subtitle: "Tuna and onion on a sambal sauce.",
        item_url: "https://en.wikipedia.org/wiki/Pizza",
        image_url: "http://www.phdelivery.com.my/i/menu/pizza/pizza_spicytuna.jpg",
        buttons: [/*{
         type: "web_url",
         url: "https://en.wikipedia.org/wiki/Pizza",
         title: "Open Web URL"
         },*/ {
            type: "postback",
            title: "Show SPICY TUNA",
            payload: "SPICY TUNA"
        }]
    };

    try {
        var data = JSONbig.parse(req.body);
        //console.log(data);
        switch(data.result.action){
            //check for intent action from requeset
            case 'show_pizza':
                //check if we receive parameters from intent
                if(isDefined(data.result.parameters['pizza_type']) == true){
                    switch(data.result.parameters.pizza_type){
                        case 'HAWAIIAN CHICKEN':
                            //customizing formated message template
                            generic_message.attachment.payload.elements = [];
                            generic_message.attachment.payload.elements.push(HAWAIIAN_CHICKEN);
                            generic_message.attachment.payload.elements[0].buttons[0].title = 'Go back';
                            generic_message.attachment.payload.elements[0].buttons[0].payload = 'pizza';
                            break;
                        case 'CHICKEN PEPPERONI':
                            generic_message.attachment.payload.elements = [];
                            generic_message.attachment.payload.elements.push(CHICKEN_PEPPERONI);
                            generic_message.attachment.payload.elements[0].buttons[0].title = 'Go back';
                            generic_message.attachment.payload.elements[0].buttons[0].payload = 'pizza';
                            break;
                        case 'TROPICAL CHICKEN':
                            generic_message.attachment.payload.elements = [];
                            generic_message.attachment.payload.elements.push(TROPICAL_CHICKEN);
                            generic_message.attachment.payload.elements[0].buttons[0].title = 'Go back';
                            generic_message.attachment.payload.elements[0].buttons[0].payload = 'pizza';
                            break;
                        case 'SPICY TUNA':
                            generic_message.attachment.payload.elements = [];
                            generic_message.attachment.payload.elements.push(SPICY_TUNA);
                            generic_message.attachment.payload.elements[0].buttons[0].title = 'Go back';
                            generic_message.attachment.payload.elements[0].buttons[0].payload = 'pizza';
                            break;
                    }
                } else {
                    //if we have no parameter in received query, send full template
                    generic_message.attachment.payload.elements.push(HAWAIIAN_CHICKEN, CHICKEN_PEPPERONI, TROPICAL_CHICKEN, SPICY_TUNA);
                }
            break;
                //check if we get receive requested parameters from apiai request
                if(isDefined(data.result.parameters['geo-city']) == true || isDefined(data.result.contexts.parameters['geo-city']) == true){
                    if (isDefined(data.result.parameters['geo-city']) == true) {
                        var city = data.result.parameters['geo-city'];
                    } else {
                        var city = data.result.parameters.contexts['geo-city'];
                    }
                    //setting url for external request
                    var base_url = "https://query.yahooapis.com/v1/public/yql?" + "q=select+%2A+from+weather.forecast+where+woeid+in+%28select+woeid+from+geo.places%281%29+where+text%3D%27"+city+"%27%29" + "&format=json";
                    weather_query = true;
                    //making request
                    request({
                        url: base_url,
                        method: 'GET',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        contentType :'application/x-www-form-urlencoded'
                    }, function(error, response, body){
                        if(error) {
                            console.log(error);
                            return res.status(400).json({
                                status: "error",
                                error: error
                            });
                        } else {
                            //process obtained data from external resource
                            var query = JSON.parse(body).query;
                            var results = query.results;
                            var channel = results.channel;
                            var item = channel.item;
                            var location = channel.location;
                            var units = channel.units;
                            var condition = item.condition;
                            //creating string
                            var string = "Today in " + location.city + ": " + condition.text + ", the temperature is " + condition.temp + " " + units.temperature
                            //changind formated message template
                            generic_message.attachment.payload.elements[0].title = 'Weather in' + city;
                            generic_message.attachment.payload.elements[0].subtitle = string;
                            generic_message.attachment.payload.elements[0].item_url = channel.link;
                            generic_message.attachment.payload.elements[0].image_url = channel.image.url;
                            generic_message.attachment.payload.elements[0].buttons[0].url = channel.link;
                            //return it formated to fb messenger
                            return res.status(200).json({
                                data: {
                                    facebook: generic_message
                                }
                            });
                        }
                    });
                } else {
                    return res.status(200).json({
                        data: {
                            facebook: {text: 'no city'}
                        }
                    });
                }
            break;
        }
        console.log(weather_query);
        if (weather_query != true) {
            return res.status(200).json({
                data: {
                    facebook: generic_message
                }
            });
        }
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





