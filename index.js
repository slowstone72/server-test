/* server test
edited: 2024.7.23 */

// import { Server } from "socket.io";
import express from "express";
import { createServer } from "node:http";

console.log("beep boop, looks like I'm on the air");

const port = process.env.PORT ?? 1234;

const app = express();
const server = createServer(app);

server.listen(port, () => {
    console.log(`server launched @ ${port}`);
});

app.get("/", (req, res) => {
    res.send("<u>hello, looks like i'm internetting</u>");
});