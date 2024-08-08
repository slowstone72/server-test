/* "server test"
edited: 2024.8.8 */

import { Server } from "socket.io"; // breaking news: socket.io is very inefficient for this purpose and needs to go in the bin
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
let pulseTime = 20000; // specifies when clients should send ping msgs, should probably go in the bin
let lastNewClient = Date.now(); // for tracking abnormal connections
let clientCeiling = 20; // max max clients
let maxClientsPerIPA = 2; // max clients per IP address
let maxClients = 20; // "max" clients
let clients = [];

let ipaMaxKicks = 4; // max kicks per IP address before blocking that IP
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
    chaos: 0,
    capCap: 80, // the max percentage cap of uppercase characters in a message
    kickForCap: false,
    chatFilterLevel: 2,
    chatFilterTolerance: 75
}

autoMod.chaosCap = {
    chatFilterLevel: 3,
    kickForCap: 15
}

const forgeID = () => {
    return Math.floor(Math.random() * 90000);
}

const checkIPA = ipa => {
    let count = 0;
    clients.forEach(client => (client.ipa == ipa && count ++));
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
        autoMod.chaos ++;
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
    let ipa = socket.handshake.address;
    if (ipaBlocked(ipa)) {
        socket.disconnect(); // right?
        return;
    }
    if (checkIPA(ipa) >= maxClientsPerIPA) {
        socket.emit("bye", "busy");
        socket.disconnect();
        return;
    }
    let now = Date.now();
    if (autoMod.on) {
        if (now - lastNewClient < 50 && maxClients > 3) maxClients -= 3;
        lastNewClient = now;
    }
    if (clients.length + 1 > maxClients) {
        socket.emit("bye", "busy");
        socket.disconnect();
        return;
    }
    let client = {
        socket: socket,
        id: forgeID(),
        lastPulse: now,
        lastActive: now,
        lastMessage: '',
        ipa: ipa
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
        // disabled for now due to removing wrong/too many clients - relying on "pulseTime" timeout for now:
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
        if (now - lastActive < 1000) {
            autoMod.chaos ++;
            return;
        }
        client.lastActive = now;

        // filtering & moderation:
        msg.m = msg.m.replace(/</g,"&lt;").replace(/>/g,"&gt;"); // prevent html injection
        if (autoMod.on) {
            let stripped = stripToLetters(msg.m);
            if (autoMod.capCap > 0) if (checkCapPercent(stripped) >= autoMod.capCap) {
                socket.emit("msg", { t: Date.now(), n: "Bob", m: "please don't shout" });
                if (autoMod.kickForCap) sayBye(client, "kick");
                return;
            }

            filterTest(msg.m);

            /* filterTest is called here for updating the autoMod 'chaos level',
            which controls how autoMod adjusts the chatFilterLevel alongside other restrictions.
            
            In theory, this means we can let users say whatever the badWords array says is bad,
            until they start to get a little too crazy. At that point we can start gradually increasing
            the chatFilterLevel until it becomes very strict.
            
            Here's an explanation of how the levels work for now:
            
            Level 1: badWord becomes #######

            Level 2:
            - evenAgoodWordThatIncludesAbadWord becomes #################################
            - Cocktail becomes ########
            
            Level 3:
            - Similar words to bad words are filtered, so even budWord is treated as a badWord.
            - Messages don't send if filtered, and user is kicked.
            This will likely prevent words with letter swaps from bypassing the filter.
            - Anything shorter than the actual word that might still be similar is ignored.
            This is in regards to any acronyms that might be falsely picked up by this filter.
            
            Conclusion:

            The 'dynamic' element of a fluctuating chat filter level could be useful.
            It might be a nice compromise between free speech and blasting the chat box
            with something unfavourable for 24 hours.

            On the other hand it could end the world, I don't know. Either way,
            it's worth noting that this only really applies to English text anyway.

            autoMod is mainly intended to prevent people/bots from massively spamming the server 24/7
            by shrinking the boundaries the more they are pushed, and then expanding them once things calm down.

            So, yes, you can spam "poppycock" repeatedly, within certain conditions:
            - you aren't sending it too quickly
            - the autoMod chaos level isn't such that the server becomes super strict

            The chaos level is influenced by:
            - messages containing bad words
            - messages sent too quickly
            - abnormal amounts of new clients
            - the amount of clients the server has kicked

            Anything beyond that is out of the question for now. */

            let chatFilterLevel = client.chatFilterLevel || autoMod.chatFilterLevel;
            // client.chatFilterLevel: in the future the server could set filter levels per client to offset abuse per user without punishing everybody
            switch (chatFilterLevel) {
                case 1:
                    msg.m = filterText(msg.m);
                    break;
                case 2:
                    msg.m = filterTextIntense(msg.m);
                    break;
                case 3:
                    if (isBad(msg.m, autoMod.chatFilterTolerance)) {
                        socket.emit("msg", { t: now, n: "Bob", m: "please be respectful and take care not to spam" });
                        sayBye(client, "kick");
                        return;
                    }
            }
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

// autoMod uses a "chaos" integer to dynamically adjust certain restrictions:
if (autoMod.on) setInterval(() => {
    if (maxClients < clientCeiling) maxClients ++;
    if (!autoMod.on) return;
    if (clientCeiling !== maxClients) autoMod.chaos += 2;
    // adjust chatFilterLevel:
    if (autoMod.chaos >= autoMod.chaosCap.chatFilterLevel) if (autoMod.chatFilterLevel !== 3) autoMod.chatFilterLevel ++;
    if (autoMod.chaos == 0) if (autoMod.chatFilterLevel > 0) autoMod.chatFilterLevel --;
    autoMod.kickForCap = autoMod.chaos > autoMod.chaosCap.kickForCap;
    if (autoMod.chaos == 0) return;
    autoMod.chaos --;
}, 10000);

const isBad = (input, tolerance) => {
    if (!tolerance) tolerance = 50;
    input = input.toLowerCase();
    let result = false;
    input.split(" ").forEach(word => { // can still be bypassed with spaces but whatever
        badWords.forEach(badWord => {
            if (word.length >= badWord.length && compareStrings(badWord, stripToLetters(word)) >= tolerance) result = true;
        });
    });
    return result;
}

const filterTest = input => {
    input = input.toLowerCase();
    let strippedInput = stripToLetters(input);
    badWords.forEach(badWord => (strippedInput.includes(badWord) && autoMod.chaos ++));
}

const filterText = input => {
    input = input.toLowerCase();
    input.split(" ").forEach(word => { // can still be bypassed with spaces but whatever
        badWords.forEach(badWord => {
            if (word == badWord) {
                input = input.replace(new RegExp(escapeRegExp(badWord), "g"), "#".repeat(badWord.length));
                autoMod.chaos ++;
            }
        });
    });
    return input;
}

const filterTextIntense = input => {
    input = input.toLowerCase();
    let strippedInput = stripToLetters(input);
    badWords.forEach(badWord => {
        if (strippedInput.includes(badWord)) {
            input = input.replace(new RegExp(escapeRegExp(badWord), "g"), "#".repeat(badWord.length));
            autoMod.chaos ++;
        }
    });
    return input;
}

const escapeRegExp = input => {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

const stripToLetters = input => {
    let validChars = "abcdefghijklmnopqrstuvwyxyz".split("");
    input = input.split("");
    input.forEach((char, index) => {
        if (!validChars.includes(char.toLowerCase())) delete input[index];
    });
    return input.join("");
}

const compareStrings = (str1, str2) => { // https://stackoverflow.com/a/67145786
    let shortest = str2.length >= str1.length ? str1 : str2;
    let longest = str2.length < str1.length ? str1 : str2;
    let matches = 0;
    
    /* "check if index of shortest matches index of longest
    matches index of longest, and if so (&& means do next
    expression) add the total number of matches by one"
    
    i never thought to shorten expressions in that way
        if (alive) keepLiving();
    becomes:
        (alive && keepLiving());
    i'm not sure if it impacts 'code readability' though,
    i guess not but it doesn't really make it much shorter either
    just sort of 'sleaker' i guess */

    shortest.split("").forEach((item, index) => ((item == longest[index]) && (matches ++)));
    
    return matches / shortest.length * 100;
}

const checkCapPercent = input => {
    let chars = input.split("");
    let count = 0;
    chars.forEach(char => ((char.toUpperCase() == char) && (count ++)));
    return count / chars.length * 100;
}

const unDiscreetanize = input => {
    let key = " abcdefghijklmnopqrstuvwyxy".split("");
    input = input.split(" "); // break character
    let output = input;
    input.forEach((char, index)=> {
        output[index] = key[Number(char)] || "?";
    });
    return output.join("");
}

const undiscreetArray = input => {
    let output = input;
    input.forEach((item, index) => {
        output[index] = unDiscreetanize(item);
    });
    return output;
}

const badWords = undiscreetArray([ // incredible method of obscuring bad words - should be in a json/db
    "6 21 3 11",
    "2 9 20 3 8",
    "14 9 7 7 5 18",
    "14 9 7 7 1",
    "3 21 14 20",
    "1 19 19",
    "3 15 3 11",
    "4 9 3 11",
    "4 9 12 4 15",
    "23 1 14 11",
    "1 19 19 8 15 12 5",
    "16 21 19 19 25",
    "22 1 7 9 14 1",
    "16 5 14 9 19",
    "20 9 20 19",
    "6 1 7 7 15 20",
    "16 15 18 14"
]);

/* const discreetanize = input => {
    let key = " abcdefghijklmnopqrstuvwyxy".split("");
    input = input.split("");
    output = input;
    input.forEach((char, index) => {
        output[index] = key.includes(char) ? `${key.indexOf(char)}` : "?";
        output[index] += " "; // break character between letters
    });
    return output.join(""); // .trim();
}

const discreetArray = input => {
    let output = input;
    input.forEach((item, index) => {
        output[index] = discreetanize(item);
    });
    return output;
} */