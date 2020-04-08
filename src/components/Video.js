import React from "react";
import { confirmAlert } from "react-confirm-alert";
import "react-confirm-alert/src/react-confirm-alert.css";
import Xirsys from "../modules/Xirsys";
import { config } from "../config";
import getBlobDuration from "get-blob-duration";
import adapter from 'webrtc-adapter';

// function for creating unique user id
const getID = () => {
    return "xx".replace(/[xy]/g, function (c) {
        let r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const userId = getID(); // user unique session ID
const eventId = 1; // event id (will be replaced by our event ID when integrated)
var leavePage = true; // variable for leave page
var socketConnection = null;
var peerConnection = null;
var connectedUserName;
var connectedUserConnectionId;


function sendMessage(message) {
    //attach the other peer username to our messages 
    if (connectedUserName) {
        message.name = connectedUserName;
    }
    if (connectedUserConnectionId) {
        message.connectedUserId = connectedUserConnectionId;
    }
    message.myName = userId;
    socketConnection.send(JSON.stringify(message));
}


// window event listener for page leaving
window.addEventListener("beforeunload", function (e) {
    if (!leavePage) {
        let confirmationMessage = "Are you sure to leave the page?";
        (e || window.event).returnValue = confirmationMessage; // Gecko + IE
        return confirmationMessage; // Gecko + Webkit, Safari, Chrome etc.
    }

});

// media properties
const mediaConstraints = {
    audio: true,
    video: true
};


class Video extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            connectionType: "sender",
            callId: "",
            isCalling: false,
            offer: null,
        };
        this.senderVideoTag = React.createRef();
        this.receiverVideoTag = React.createRef();
        this.remoteStream = null;
        this.mediaRecorder = null;
        this.call = null;
        this.videoFile = null;

        this.componentDidCallback = this.componentDidCallback.bind(this);
    }

    handleOnChange(e) {
        let { name, value } = e.target;
        this.setState({ [name]: value });
    }

    componentDidMount() {
        Xirsys.doICE(this.componentDidCallback);
    }

    componentDidCallback() {
        socketConnection = new WebSocket(config.aws.websocket);

        socketConnection.onopen = function () {
            console.log("Connected to the signaling server");
            sendMessage({
                type: "login",
                name: userId
            });
        };

        // when we got a message from a signaling server 
        socketConnection.onmessage = (msg) => {
            // console.log("Got message", msg.data);

            let data = JSON.parse(msg.data);

            switch (data.type) {
                case "login":
                    this.initConnection();
                    break;
                // when somebody wants to call us 
                case "offer":
                    this.handleOffer(data);
                    break;
                case "answer":
                    this.handleAnswer(data.answer, data.myConnId);
                    break;
                // when a remote peer sends an ice candidate to us 
                case "candidate":
                    this.handleCandidate(data.candidate);
                    break;
                case "leave":
                    this.handleLeave();
                    break;
                case "signedUrl":
                    this.sendDataToSignedUrl(data.data);
                    break;
                default:
                    break;
            }
        };

        socketConnection.onerror = function (err) {
            console.log("Got error", err);
        };
    }

    initConnection(recreateConnection = false, callbackFunction) {
        navigator.mediaDevices.getUserMedia(mediaConstraints)
        .then(stream => { 
            let configuration = {
                "iceServers": [Xirsys.getServers()[0]]
            };

            peerConnection = new RTCPeerConnection(configuration);

            try {
                this.senderVideoTag.current.srcObject = stream;
            } catch (e) {
                this.senderVideoTag = {
                    current: {
                        srcObject: stream
                    }
                };
            }

            // setup stream listening 
            peerConnection.addStream(stream);

            //when a remote user adds stream to the peer connection, we display it 
            peerConnection.onaddstream = (e) => {
                let remoteStream = e.stream;
                this.setState({ isCalling: true });

                // start stream recording 
                this.startRecording(remoteStream);
                leavePage = false;

                // show remote stream
                try {
                    this.receiverVideoTag.current.srcObject = remoteStream;
                } catch (e) {
                    this.receiverVideoTag = {
                        current: {
                            srcObject: remoteStream
                        }
                    };
                }
                this.remoteStream = remoteStream;
            };

            // setup ice handling 
            peerConnection.onicecandidate = event => {
                if (event.candidate) {
                    sendMessage({
                        type: "candidate",
                        candidate: event.candidate
                    });
                }
            };

            // call function when recreate connection
            if (recreateConnection) {
                callbackFunction();
            }
         })
         .catch(error => alert(`Failed to get local stream: ${error}`))
    }

    handleLeave(finishCall = false) {
        let { isCalling } = this.state;
        peerConnection.close();
        peerConnection.onicecandidate = null;
        this.receiverVideoTag = React.createRef();

        if (finishCall && isCalling) {
            this.stopVideoRecord();
        } else if (!finishCall && isCalling) {
            this.stopVideoRecord();
            alert(`${connectedUserName} finished the call`);
        } else if (!finishCall && !isCalling) {
            alert(`${connectedUserName} decline the call`);
        }

        connectedUserName = null;
        this.setState({ isCalling: false });
    }

    handleAnswer(answer, connectedId) {
        connectedUserConnectionId = connectedId;
        peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }

    handleOffer(data) {
        let { offer, name, myConnId } = data;
        connectedUserName = name;
        connectedUserConnectionId = myConnId;

        confirmAlert({
            title: "Someone is calling to you",
            message: `User with id ${name} is calling to you. Answer?`,
            buttons: [
                {
                    label: "Yes",
                    onClick: () => {

                        this.setState({
                            connectionType: "receiver"
                        });

                        peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

                        //create an answer to an offer 
                        peerConnection.createAnswer(answer => {
                            peerConnection.setLocalDescription(answer);

                            sendMessage({
                                type: "answer",
                                answer: answer
                            });
                        }, error => alert(`Error when creating an answer: ${error}`));
                    }
                },
                {
                    label: "No",
                    onClick: () => {
                        sendMessage({
                            type: "leave"
                        });
                        this.handleLeave(true);
                    }
                }
            ]
        });

    }

    handleCandidate(candidate) {
        // check current connection state:
        // if is available - add ice candidate, else - recreate connection and add ice candidate
        if (peerConnection.connectionState === "closed") {
            this.initConnection(true, () => peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {}))
        } else {
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => {});
        }        
    }

    stopVideoRecord() {
        this.mediaRecorder.stop();
        this.remoteStream.getTracks().forEach(track => track.stop());
        this.setState({ isCalling: false });
    }

    handleCall() {
        let { callId } = this.state;
        // check if the id is not null and is not the user id
        if (callId === userId) {
            alert("You can't call yourself");
            return
        } else if (callId === "") {
            alert("Please set id");
            return
        }

        connectedUserName = this.state.callId;

        // check current connection state:
        // if is available - create an offer, else - recreate connection and create an offer
        if (peerConnection.connectionState === "closed") {
            this.initConnection(true, () => this.createOffer());
        } else {
            this.createOffer();
        }
    }

    createOffer() {
        peerConnection.createOffer(offer => {
            sendMessage({
                type: "offer",
                offer: offer,
            });

            peerConnection.setLocalDescription(offer);
        }, function (error) {
            alert(`Error when creating an offer: ${error}`);
        });
    }

    handleFinishCall() {
        sendMessage({
            type: "leave"
        });
        this.handleLeave(true);
    }

    startRecording(stream) {
        let mediaRecorder = new MediaRecorder(stream);
        let recordedChunks = [];

        mediaRecorder.ondataavailable = event => recordedChunks.push(event.data);
        mediaRecorder.start();
        mediaRecorder.onstop = e => {
            let mediaBlob = new Blob([recordedChunks[0]], { type: "video/mp4" }); // create video blob object after stream
            this.videoFile = new File([mediaBlob], "File name", { type: "video/mp4" });
            (async () => {
                let videoDuration = await getBlobDuration(mediaBlob);
                let reader = new window.FileReader();
                reader.readAsDataURL(mediaBlob);
                reader.onloadend = () => this.saveStreamInformation(videoDuration, mediaBlob);
            })()
        };

        this.mediaRecorder = mediaRecorder;
    }

    saveStreamInformation(videoDuration) {
        // information about stream

        const data = {
            "type": "createSignedUrl",
            "eventid": eventId.toString(),
            "userid": 1, // set user id here!
            "video_length": Math.ceil(videoDuration).toString(),
            "role": this.state.connectionType,
            "filename": `${eventId}-${userId}.mp4`,
            "mimetype": "video/mp4",
            "completed": true,
            "timestamp": new Date().getTime()
        };
        sendMessage(data);
    }

    sendDataToSignedUrl(response) {
        // send message with stream information

        if (response.event === "success") {
            let formData = new FormData();
            let { fields } = response.data;

            // add fields
            for (let f in fields) { // fields from signed url request
                if (!fields.hasOwnProperty(f)) continue;
                formData.append(f, fields[f]);
            }

            // add file
            formData.append("file", this.videoFile);

            fetch(response.data.url, {
                method: "POST",
                body: formData
            })
                .then(response => console.log("success", response))
                .catch(error => alert(`error ${error}`))
                .finally(() => {
                    leavePage = true;
                });
        } else {
            leavePage = true;
        }
    }

    render() {
        let { connectionType, callId, isCalling } = this.state;

        return (
            <div className="container">
                My id: {userId}
                <div className="select-container">
                    <select name="connectionType"
                        value={connectionType}
                        onChange={e => this.handleOnChange(e)}>
                        <option value="receiver">Receiver</option>
                        <option value="sender">Sender</option>
                    </select>
                </div>

                {connectionType === "sender"
                    ? (
                        <div>
                            <input name="callId" value={callId} onChange={e => this.handleOnChange(e)}
                                placeholder="Please enter the id number" />
                            <button onClick={() => this.handleCall()}>Call</button>
                        </div>
                    )
                    : (
                        <div>
                            <button>Receive</button>
                        </div>
                    )
                }

                <div>
                    <div className="video-panel">
                        <div>
                            Your video
                            <br />
                            <video id="user-video" autoPlay={true} ref={this.senderVideoTag} />
                        </div>

                        <div>
                            Your friend video
                            <br />
                            <video id="friend-video" autoPlay={true} ref={this.receiverVideoTag} />
                        </div>
                    </div>

                    {isCalling && <button onClick={() => this.handleFinishCall()}>Finish call</button>}

                </div>
            </div>
        )
    }
}

export default Video;