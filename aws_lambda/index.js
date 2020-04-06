// Load the AWS SDK and modules
const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
const apigw = new AWS.ApiGatewayManagementApi({ apiVersion: '2018-11-29', endpoint: process.env.socket_url });
const s3 = new AWS.S3({ apiVersion: "2006-03-01", signatureVersion: "v4" });

//all connected to the server users 
var users = {};

// send json data to user by connectionId
function sendTo(connectionId, data) {
    apigw.postToConnection({ ConnectionId: connectionId, Data: JSON.stringify(data) }, function (err, data) {
        if (err) {
            console.log("error", err);
        }
    });
}

// handler
exports.handler = (event, context, callback) => {

    // missing routekey
    if (typeof event.requestContext === 'undefined' || typeof event.requestContext.routeKey === 'undefined' || event.requestContext.routeKey === '') {
        callback(null, { "statusCode": 401, "body": '{"event":"error","data":"Missing action and routeKey"}' });
        return false;
    }

    // connection ID
    let cid = event.requestContext.connectionId;


    // connect
    if (event.requestContext.routeKey === '$connect') {
        socketConnect();

        // request
    } else if (event.requestContext.routeKey === '$default') {
        socketRequest()

        // disconnect
    } else if (event.requestContext.routeKey === '$disconnect') {
        socketDisconnect()

        // unknown/unsupported request
    } else {
        callback(null, { "result": false, "message": "Unknown request" });
    }



    // CONNECT
    function socketConnect() {

        // create session
        let session = {
            "id": {
                S: cid
            },
            "timestamp": {
                N: new Date().getTime().toString()
            }

            // todo: any other params that need to be tracked
        };


        // store session
        ddb.putItem({
            Item: session,
            TableName: process.env.ddb_sessions
        }, function (err, data) {
            if (err) {
                console.log("Unable to add session to db", err);
                callback(null, { "result": false, "error": "db_error", "message": "Unable to store session" });
                return;
            }

            // all good
            callback(null, { "statusCode": 200, "body": '{"event":"connected"}' });
        });
    }


    // REQUEST
    function socketRequest() {
        // identify user from sessions
        let cid = event.requestContext.connectionId;
        let connection = event.requestContext;

        var data;

        //accepting only JSON messages 
        try {
            data = JSON.parse(event.body);
        } catch (e) {
            let errorMessage = "Invalid JSON";
            data = {};
            sendTo(connection, {
                type: "error",
                message: errorMessage
            });
            callback(null, { "result": false, "error": true, "message": errorMessage });
        }

        //switching type of the user message 
        switch (data.type) {
            //when a user tries to login

            case "login":

                //if anyone is logged in with this username then refuse 
                if (users[data.name]) {
                    sendTo(connection, {
                        type: "login",
                        success: false
                    });
                } else {
                    //save user connection on the server 
                    users[data.name] = connection;
                    connection.name = data.name;

                    sendTo(connection.connectionId, {
                        type: "login",
                        success: true,
                        connectionId: connection.connectionId
                    });
                }

                break;

            case "offer":
                //if UserB exists then send him offer details 
                var conn = users[data.name];

                if (conn != null) {
                    //setting that UserA connected with UserB 
                    connection.otherName = data.name;

                    sendTo(conn.connectionId, {
                        type: "offer",
                        offer: data.offer,
                        name: conn.name,
                        connectionId: conn.connectionId,
                        myConnId: connection.connectionId
                    });
                }

                break;

            case "answer":
                //for ex. UserB answers UserA 
                sendTo(data.connectedUserId, {
                    type: "answer",
                    answer: data.answer,
                    connectionId: data.connectedUserId,
                    myConnId: connection.connectionId
                });

                break;

            case "candidate":
                let connCand = users[data.name];
                
                if (data.hasOwnProperty("connectedUserId")) {
                  sendTo(data.connectedUserId, {
                      type: "candidate",
                      candidate: data.candidate,
                      name: data.myName,
                      myConnId: connection.connectionId
                  });
                }
      			
                if(connCand != null) { 
                  sendTo(connCand.connectionId, { 
                      type: "candidate",
                      name: data.myName,
                      candidate: data.candidate,
                      connectionId: connCand.connectionId,
                      myConnId: connection.connectionId
                  }); 
                }
      			
                break;

            case "leave":
                sendTo(data.connectedUserId, {
                    type: "leave"
                });

                break;

            case "createSignedUrl":
                let fields = {
                    key: data.filename,
                    "x-amz-meta-eventid": data.eventid,
                    "x-amz-meta-role": data.role,
                    "x-amz-meta-mimetype": data.mimetype,
                    "x-amz-meta-length": data.video_length
                };

                s3.createPresignedPost({ Bucket: process.env.s3_archive, Fields: fields, Expires: 7200 }, function (err, res) {
                    let bodyData = {};

                    if (err) {
                        bodyData = { "event": "error", "data": "Unable to get signed URL" }
                        callback(null, { "statusCode": 401, "body": JSON.stringify(bodyData) });
                        return false;
                    }

                    bodyData = {
                        "event": "success",
                        "data": {
                            "url": res.url,
                            "expires": new Date().getTime() + 7200000,
                            "fields": res.fields
                        }
                    }

                    // response
                    callback(null, { "statusCode": 200, "body": JSON.stringify(bodyData["data"]) });
                    sendTo(cid, {
                        type: "signedUrl",
                        data: bodyData
                    });
                });

                break;

            default:
                sendTo(connection, {
                    type: "error",
                    message: "Command not found: " + data.type
                });

                break;
        }

        // response
        callback(null, { "statusCode": 200, "body": JSON.stringify({}) });

    }


    // DISCONNECT
    function socketDisconnect() {
        // identify user from sessions
        let cid = event.requestContext.connectionId;

        // todo: any actions needed for disconnect?

        // done
        callback(null, { "statusCode": 200, "body": '{"event":"disconnected"}' });
    }

};
