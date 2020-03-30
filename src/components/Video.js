import React from "react";
import Peer from "peerjs";
import {confirmAlert} from "react-confirm-alert";
import "react-confirm-alert/src/react-confirm-alert.css";
import Xirsys from "../modules/Xirsys";
import Sockette from "sockette";
import { config } from "../config";
import getBlobDuration from "get-blob-duration";

// function for creating unique user id
const getID = () => {
    return "xx".replace(/[xy]/g, function (c) {
        let r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const userId = getID(); // user unique session ID
const eventId = 1; // event id (will be replaced by our event ID when integrated)
var peer = null; // peer connection
var leavePage = true; // variable for leave page



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
    video: {
        "min": {"width": "440", "height": "250"},
        "max": {"width": "800", "height": "600"}
    }
};


class Video extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            connectionType: "sender",
            callId: "",
            isCalling: false,
            temp: ""
        };
        this.senderVideoTag = React.createRef();
        this.receiverVideoTag = React.createRef();
        this.mediaRecorder = null;
        this.call = null;

        this.startStream = this.startStream.bind(this);
        this.componentDidCallback = this.componentDidCallback.bind(this);
    }

    handleOnChange(e) {
        let {name, value} = e.target;
        this.setState({[name]: value});
    }

    componentDidMount() {
        Xirsys.doICE(this.componentDidCallback);
    }

    componentDidCallback() {
        let {peer_key} = config;

        // initialize peer connection
        if (peer_key !== null) {
            peer = new Peer({ key: peer_key, debug: 3, config: Xirsys.getServers()});
        } else {
            peer = new Peer(userId);
        }
        
        // peer error handler
        peer.on("error", function (err) {
            alert("peer error", err);
        });

        var userMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

        // peer call handler
        peer.on("call", (call) => {
            this.call = call;
            confirmAlert({
                title: "Someone is calling to you",
                message: `User with id ${call.peer} is calling to you. Answer?`,
                buttons: [
                    {
                        label: "Yes",
                        onClick: () => this.callEvents(userMedia)
                    },
                    {
                        label: "No",
                        onClick: () => {
                            var conn = peer.connect(this.call.peer);
                            conn.on("open", () => {
                                leavePage = true;
                                new Promise((resolve, reject) => conn.send("decline!"))
                                    .then(resolve => {
                                        conn.close();
                                        this.senderVideoTag = React.createRef();
                                    });
                            });
                        }
                    }
                ]
            });
        });

        // peer connection handler:
        // used to close the connection when the user to whom you called decline the call
        peer.on("connection", conn => {
            conn.on("data", msg => {
                if (msg) {
                    leavePage = true;
                    this.stopVideoRecord();
                    alert("The call was canceled");
                }
            });
        });
    }

    callEvents(userMedia) {
        userMedia({video: true, audio: true}, stream => {
            this.setState({
                isCalling: true,
                connectionType: "receiver"
            });

            try {
                this.senderVideoTag.current.srcObject = stream;
            } catch (e) {
                this.senderVideoTag = {
                    current: {
                        srcObject: stream
                    }
                }
            }
            this.call.answer(stream); // anwer the call
            this.call.on("stream", remoteStream => { // stream start event
                this.startRecording(remoteStream);
                leavePage = false;

                try {
                    this.receiverVideoTag.current.srcObject = remoteStream;
                } catch (e) {
                    this.receiverVideoTag = {
                        current: {
                            srcObject: remoteStream
                        }
                    }
                }
            });
            this.call.on("close", () => { // stream close event
                this.receiverVideoTag = React.createRef();
                this.mediaRecorder.stop();
                this.stopVideoRecord(stream);
            });
        }, err => alert("Failed to get local stream", err));
    }

    stopVideoRecord(stream = undefined) {
        if (stream !== undefined) {
            stream.getTracks().forEach(track => track.stop());
        }
        if (this.senderVideoTag.current !== null && this.senderVideoTag.current.srcObject !== null) {
            this.senderVideoTag.current.srcObject.getTracks().forEach(track => track.stop());
        }
        this.senderVideoTag = React.createRef();
        this.setState({isCalling: false});
    }

    startStream() {
        var getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

        getUserMedia(mediaConstraints, (stream) => {
            var call = peer.call(this.state.callId, stream);

            this.setState({isCalling: true});

            try {
                this.senderVideoTag.current.srcObject = stream;
            } catch (e) {
                this.senderVideoTag = {
                    current: {
                        srcObject: stream
                    }
                };
            }

            if (peer.id !== null) {
                call.on("stream", (remoteStream) => { // stream start event
                    leavePage = false;
                    this.startRecording(remoteStream);
                    try {
                        this.receiverVideoTag.current.srcObject = remoteStream;
                    } catch (e) {
                        this.receiverVideoTag = {
                            current: {
                                srcObject: remoteStream
                            }
                        };
                    }
                });
                call.on("close", () => { // stream close event
                    this.receiverVideoTag = React.createRef();
                    this.mediaRecorder.stop();
                    this.stopVideoRecord(stream);
                });
            }
            this.call = call;
        }, err => alert("Failed to get local stream", err));

    }

    handleCall() {
        let {callId} = this.state;
        // check if the id is not null and is not the user id
        if (callId === userId) {
            alert("You can\"t call yourself");
            return
        } else if (callId === "") {
            alert("Please set id");
            return
        }

        Xirsys.doICE(this.startStream);
    }

    handleFinishCall() {
        this.call.close();
        if (this.mediaRecorder !== null && this.mediaRecorder.state === "recording") {
            this.mediaRecorder.stop();
        }
    }

    startRecording(stream) {
        let mediaRecorder = new MediaRecorder(stream);
        let recordedChunks = [];

        mediaRecorder.ondataavailable = event => recordedChunks.push(event.data);
        mediaRecorder.start();
        mediaRecorder.onstop = e => {
            let mediaBlob = new Blob([recordedChunks[0]], {type: "video/mp4"}); // create video blob object after stream

            (async () => {
                let videoDuration = await getBlobDuration(mediaBlob);
                let reader = new window.FileReader();
                reader.readAsDataURL(mediaBlob);
                reader.onloadend = () => {
                     this.saveStreamInformation(videoDuration, mediaBlob);
                }
            })()
        };

        this.mediaRecorder = mediaRecorder;
    }

    saveStreamInformation(videoDuration, mediaBlob) {

        const file = new File([mediaBlob], "File name",{ type: "video/mp4" })
        // information about stream

        const data = {
            "eventid": eventId.toString(),
            "userid": 1, // set user id here!
            "video_length": Math.ceil(videoDuration).toString(),
            "role": this.state.connectionType,
            "filename": `${eventId}-${userId}.mp4`,
            "mimetype": "video/mp4",
            "completed": true,
            "timestamp": new Date().getTime()
        };

        // create websocket connection and send message with stream information
        const ws = new Sockette(config.aws.websocket, {
            timeout: 5e3,
            maxAttempts: 10,
            onopen: e => {
                console.log("open connection!");
                ws.json(data);
                // ws.close()
                
            },
            onmessage: e => {
                let response = JSON.parse(e.data);
                if (response.event === "success") {
                    let formData = new FormData();
                    let {fields} = response.data;

                    // add fields
                    for (let f in fields) { // fields from signed url request
                        if(!fields.hasOwnProperty(f)) continue;
                        formData.append(f, fields[f]);
                    }

                    // add file
                    formData.append("file", file);

                    fetch(response.data.url, { 
                        method: "POST",
                        body: formData
                    })
                    .then((response) => console.log("success", response))
                    .catch((error) => alert("error", error))
                    .finally(() => {
                        leavePage = true;
                        ws.close();
                    });
                }
            },
            onreconnect: e => console.log("Reconnecting...", e),
            onclose: e => console.log("Closed!", e),
            onerror: e => console.log("Error:", e)
        });
        leavePage = true;
    }

    render() {
        let {connectionType, callId, isCalling} = this.state;

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
                                   placeholder="Please enter the id number"/>
                            <button onClick={() => this.handleCall()}>Call</button>
                        </div>
                    )
                    : (
                        <div>
                            <button>Receive</button>
                        </div>
                    )
                }

                {isCalling && (
                    <div>
                        <div className="video-panel">
                            <div>
                                Your video
                                <br/>
                                <video id="user-video" autoPlay={true} ref={this.senderVideoTag}/>
                            </div>

                            <div>
                                Your friend video
                                <br/>
                                <video id="friend-video" autoPlay={true} ref={this.receiverVideoTag}/>
                            </div>
                        </div>

                        <button onClick={() => this.handleFinishCall()}>Finish call</button>

                    </div>
                )}

            </div>
        )
    }
}

export default Video;