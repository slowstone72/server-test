/* server test
edited: 2024.7.23 */

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
let pulseTime = 40000
let lastNewClient = Date.now(); // for tracking abnormal connections
let clientCeiling = 20; // max max clients
let maxClients = 20; // "max" clients
let clients = [];

const updateClients = () => {
    let filteredClients = [];
    clients.forEach(item => {
        filteredClients.push({
            id: item.id,
            n: item.name
        });
    });
    io.emit("clients", filteredClients);
    io.emit("max", maxClients);
}

const sayBye = (client, code) => {
    if (!code) {
        client.socket.emit("bye", "kick");
    } else {
        client.socket.emit("bye", code);
    }
    client.socket.disconnect();
    clients.splice(clients.indexOf(client), 1);
    updateClients();
}

io.on("connection", socket => {
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
        id: Math.floor(Math.random() * 90000),
        lastPulse: nowDate,
        lastActive: nowDate,
        lastMessage: ""
    }
    client.name = `Guest${client.id}`;
    clients.push(client);
    if (beVerbose) console.log(`connect #${client.id}`);
    updateClients();
    socket.emit("chistory", chatHistory);
    socket.emit("p", pulseTime);
    socket.on("disconnect", () => {
        if (beVerbose) console.log(`disconnect #${client.id}`);
        clients.splice(clients.indexOf(client), 1);
        updateClients();
    });
    socket.on("msg", msg => {
        let nowDate = Date.now();
        if (nowDate - client.lastActive < 1000) return;
        client.lastActive = nowDate;
        if (typeof msg !== "object" || typeof msg.m !== "string" || msg.m.length > maxMessageLength) {
            sayBye();
            return;
        }
        msg.m = msg.m.replace(/</g,"&lt;").replace(/>/g,"&gt;");
        if (msg.m == client.lastMessage) return;
        let outbox = {
            t: nowDate,
            n: client.name,
            m: msg.m
        };
        io.emit("msg", outbox);
        client.lastMessage = outbox.m;
        chatHistory.push(outbox);
        if (chatHistory.length > maxChatHistory) chatHistory.splice(0, 1)[0];
    });
});

const clientPulseChecker = setInterval(() => {
    if (maxClients < clientCeiling) maxClients ++;
    clients.forEach(client => {
        // check user activity:
        if (Date.now() - client.lastPulse > pulseTime) {
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
}, maxIdleTime > pulseTime ? pulseTime : maxIdleTime);

console.log(maxIdleTime > pulseTime ? pulseTime : maxIdleTime)