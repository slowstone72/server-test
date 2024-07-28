/* server test
edited: 2024.7.28 */

import { Server } from "socket.io";
import express from "express";
import { createServer } from "node:http";

const port = process.env.PORT || 1234;
const beVerbose = false;

if (beVerbose) console.log("beep boop, looks like I'm on the air");

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

/* app.get("/", (req, res) => {
    res.send("<u>hello, looks like i'm internetting</u>");
    // 301 perm, 302 temp
}); */

server.listen(port, () => {
    if (beVerbose) console.log(`server launched @ ${port}`);
});

let maxMessageLength = 512;
let maxChatHistory = 20;
let chatHistory = [{
    "t": Date.now(),
    "n": "Server",
    "m": "Hello, send a nice message :-)"
}];

let maxIdleTime = 60000;
let pulseTime = 20000;
let lastNewClient = Date.now(); // for tracking abnormal connections
let clientCeiling = 20; // max max clients
let maxClientsPerIPA = 2; // max clients per IP address
let maxClients = 20; // "max" clients
let clients = [];

let ipaMaxKicks = 4;
let ipaBlockTime = 200000;
let ipaStoreTime = 100000; // can be overriden for blocked IPAs
let ipaStore = [
    {
        "i": "123.456.7.8", // ip address
        "t": Date.now(), // date stored
        "b": 2000, // ban time
        "k": 4 // amount of kicks on this ip
    }
]

// configure automod:
let autoMod = {
    on: true,
    disallowAllCaps: true
}

const forgeID = () => {
    return Math.floor(Math.random() * 90000);
}

const checkIPA = ipa => {
    let count = 0;
    clients.forEach(client => {
        if (client.ipa == ipa) count ++;
    });
    return count;
}

const ipaBlocked = ipa => {
    let output = false;
    ipaStore.forEach(item => { // can probably replace with .filter or something
        if (item.i == ipa) {
            if (item.b) output = true;
        }
    });
    return output;
}

const updateClients = () => {
    let filteredClients = [];
    clients.forEach(client => {
        filteredClients.push({
            id: client.id,
            n: client.name
        });
    });
    io.emit("max", maxClients);
    io.emit("clients", filteredClients);
}

const sayBye = (client, code) => {
    if (!code) code = "kick";
    client.socket.emit("bye", code);
    client.socket.disconnect();
    clients.splice(clients.indexOf(client), 1);
    updateClients();
    // record the amount of kicks for this IPA:
    if (code == "kick") {
        let found = false;
        ipaStore.forEach(ipa => { // can be simplified also probably
            if (ipa.i == client.ipa) {
                ipaStore[ipaStore.indexOf(ipa)].k ++;
                if (ipaStore[ipaStore.indexOf(ipa)].k >= ipaMaxKicks) {
                    ipaStore[ipaStore.indexOf(ipa)].b = Date.now();
                }
                found = true;
            }
        });
        if (found) return;
        ipaStore.push({
            i: client.ipa,
            t: Date.now(),
            k: 1
        });
    }
}

io.on("connection", socket => {
    let IPA = socket.handshake.address;
    if (ipaBlocked(IPA)) {
        socket.disconnect(); // right?
        return;
    }
    if (checkIPA(IPA) >= maxClientsPerIPA) {
        socket.emit("bye", "busy");
        socket.disconnect();
        return;
    }
    let nowDate = Date.now();
    if (nowDate - lastNewClient < 50 && maxClients > 3) maxClients -= 3;
    lastNewClient = nowDate;
    if (clients.length + 1 > maxClients) {
        socket.emit("bye", "busy");
        socket.disconnect();
        return;
    }
    let client = {
        socket: socket,
        id: forgeID(),
        lastPulse: nowDate,
        lastActive: nowDate,
        lastMessage: "",
        ipa: socket.handshake.address
    }
    client.name = `Guest${client.id}`;
    clients.push(client);
    if (beVerbose) console.log(`connect #${client.id}`);
    updateClients();
    socket.emit("chistory", chatHistory);
    socket.on("chistory", () => {
        socket.emit("chistory", chatHistory);
    });
    socket.emit("p", pulseTime);
    socket.on("disconnect", () => {
        if (beVerbose) console.log(`disconnect #${client.id}`);
        /* clients.splice(clients.indexOf(client), 1);
        updateClients(); */
    });
    socket.on("msg", msg => {
        if (typeof msg !== "object" || typeof msg.m !== "string" || msg.m.length > maxMessageLength) {
            sayBye(client, "kick");
            return;
        }

        let lastActive = client.lastActive;

        // update lastActive:
        let now = Date.now();
        if (now - lastActive < 1000) return;
        client.lastActive = now;

        // filtering & moderation:
        msg.m = msg.m.replace(/</g,"&lt;").replace(/>/g,"&gt;");
        if (autoMod.on) {
            if (autoMod.disallowAllCaps) if (msg.m.toUpperCase() == msg.m) msg.m = msg.m.toLowerCase();
        }
        if (msg.m == client.lastMessage && (now - lastActive < 2000)) return;

        // create outgoing message:
        msg = {
            t: now,
            n: client.name,
            m: msg.m
        };

        // send:
        io.emit("msg", msg);

        // chat history:
        chatHistory.push(msg);
        if (chatHistory.length > maxChatHistory) chatHistory.splice(0, 1)[0];
        client.lastMessage = msg.m;
    });
});

setInterval(() => {
    if (maxClients < clientCeiling) maxClients ++;
    clients.forEach(client => {
        // check pulse:
        if (Date.now() - client.lastPulse > (pulseTime + 5000)) {
            if (beVerbose) console.log(`disconnect #${client.id} (nopulse)`);
            sayBye(client, "nopulse");
            return;
        }
        // check user activity:
        if (Date.now() - client.lastActive > maxIdleTime) {
            if (beVerbose) console.log(`disconnect #${client.id} (idle)`);
            sayBye(client, "idle");
        }
    });
    // check ipaStore, can probably be simplified:
    ipaStore.forEach(item => {
        if (!item.b && (Date.now() - item.t >= ipaStoreTime)) { // delete due to ipa store time expirery
            delete ipaStore[ipaStore.indexOf(item)];
        } else if (item.b && (Date.now() - item.b >= ipaBlockTime)) { // delete due to ipa block time expirery
            delete ipaStore[ipaStore.indexOf(item)];
        }
    });
}, maxIdleTime > pulseTime ? pulseTime : maxIdleTime);