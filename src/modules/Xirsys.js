import axios from 'axios';
import { config } from '../config';

const Xirsys = {
    onICEList: 'onICEList',
    iceServers: [],
    events: {},
    getInstance() {
        return this;
    },
    emit(sEvent, data) {
        var handlers = this.events[sEvent];
        if(!!handlers) {
            var l = handlers.length;
            for(var i=0; i<l; i++){
                var item = handlers[i];
                item.apply(this,[{type: this.onICEList}]);
            }
        }
    },
    filterPaths(arr) {
        var l = arr.length, i;
        var a = [];
        for(i=0; i<l; i++) {
            var item = arr[i];
            var v = item.url;
            if(!!v){
                item.urls = v;
                delete item.url;
            }
            a.push(item);
        }
        return a;
    },
    getServers() {
        return this.iceServers;
    },
    async doICE (callbackFunction) {
        let { ident, secret, channel } = config.xirsys.info;
        const response = await axios({
            method: 'put',
            url: '/_turn/' + channel,
            baseURL: "https://global.xirsys.net",
            headers: {
                'Content-Type': 'application/json',
                'Authorization': "Basic " + btoa(`${ident}:${secret}`)
            },
            responseType: 'json',
        }).then(resp => {
            this.iceServers = this.filterPaths(resp.data.v.iceServers);
            this.emit(this.onICEList);
            callbackFunction();
        });
        return response;
    },
};

export default Xirsys;