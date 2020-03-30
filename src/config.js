export const config = {
    "xirsys": {
        "gateway": "global.xirsys.net",
        "info": {
            "ident": "sharelookapp",
            "secret": "76a9ca42-65ae-11ea-9fc5-0242ac110004",
            "channel": "SharelookPeerToPeer"
        },
        "allowedServices": ["/_token", "/_host", "/_data", "/_ns", "/_turn"],
        "overrideAllowedChannel": false,
        "gateways": [
            "ws.xirsys.com",
            "us.xirsys.com",
            "es.xirsys.com",
            "tk.xirsys.com",
            "bs.xirsys.com",
            "sh.xirsys.com",
            "ss.xirsys.com",
            "ms.xirsys.com",
            "to.xirsys.com",
            "sp.xirsys.com"
        ]
    },
    'aws': {
        'websocket': 'wss://by4rqw2avi.execute-api.ap-southeast-1.amazonaws.com/peerjs'
    },
    'peer_key': null
};