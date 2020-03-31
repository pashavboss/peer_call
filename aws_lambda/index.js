// Load the AWS SDK and modules
const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });
const apigw = new AWS.ApiGatewayManagementApi({apiVersion: '2018-11-29', endpoint: process.env.socket_url});
const s3 = new AWS.S3({apiVersion: "2006-03-01",signatureVersion: "v4"});

// handler
exports.handler = (event, context, callback) => {

  // missing routekey
  if(typeof event.requestContext === 'undefined' || typeof event.requestContext.routeKey === 'undefined' || event.requestContext.routeKey === ''){
    console.log("Missing action and routeKey");
    callback(null, {"statusCode": 401, "body": '{"event":"error","data":"Missing action and routeKey"}'});
    return false;
  }

  // connection ID
  let cid = event.requestContext.connectionId;


  // connect
  if(event.requestContext.routeKey === '$connect') {
    socketConnect();

  // request
  }else if(event.requestContext.routeKey === '$default'){
    socketRequest()

  // disconnect
  }else if(event.requestContext.routeKey === '$disconnect'){
    socketDisconnect()

  // unknown/unsupported request
  }else{
    callback(null,{"result":false,"message":"Unknown request"});
  }



  // CONNECT
  function socketConnect(){

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
    }, function(err, data) {
      if(err){
        console.log("Unable to add session to db", err);
        callback(null,{"result":false,"error":"db_error","message":"Unable to store session"});
        return;
      }

      // all good
      callback(null, {"statusCode": 200, "body": '{"event":"connected"}'});
    });
  }


  // REQUEST
  function socketRequest() {
    // identify user from sessions
    let cid = event.requestContext.connectionId;

    ddb.getItem({Key: {"id": {S: cid}}, TableName: process.env.ddb_sessions},function(err,res){
      if(err){
        console.log("Invalid session", err);
        callback(null, {"statusCode": 401, "body": '{"event":"error","data":"Invalid session"}'});
        return false;
      }
    });
    
    let requestBody = JSON.parse(event.body);
    
    let fields = {
      key: requestBody.filename,
      "x-amz-meta-eventid": requestBody.eventid,
      "x-amz-meta-role": requestBody.role,
      "x-amz-meta-mimetype": requestBody.mimetype,
      "x-amz-meta-length": requestBody.video_length      
    };


    // signed s3 url could be done here....
    s3.createPresignedPost({Bucket: process.env.s3_archive, Fields: fields, Expires: 7200}, function(err,res){
      let bodyData = {};
    
      if (err) {
        console.log("Unable to get signed URL: ", err);
        bodyData = {"event":"error","data":"Unable to get signed URL"}
        callback(null, {"statusCode": 401, "body": JSON.stringify(bodyData)});
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
      callback(null, {"statusCode": 200, "body": JSON.stringify(bodyData["data"])});
      apigw.postToConnection({ ConnectionId: event.requestContext.connectionId, Data: JSON.stringify(bodyData) },function(err,data){
        if(err){
          console.log(err);
        }
      });
    });

  }


  // DISCONNECT
  function socketDisconnect() {
    // identify user from sessions
    let cid = event.requestContext.connectionId;

    // todo: any actions needed for disconnect?

    // done
    callback(null, {"statusCode": 200, "body": '{"event":"disconnected"}'});
  }

};
