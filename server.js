const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// static frontend
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "joinly.html"));
});

// rooms memory
const rooms = {};

io.on("connection", (socket) => {

  socket.data.roomId = null;
  socket.data.name = null;

  // =========================
  // JOIN ROOM (FIXED + SAFE)
  // =========================
  socket.on("join-room", ({ roomId, name, micOn, camOn }) => {

    if (!roomId) return;

    socket.join(roomId);

    socket.data.roomId = roomId;
    socket.data.name = name;

    if (!rooms[roomId]) rooms[roomId] = {};

    rooms[roomId][socket.id] = {
      name,
      micOn: micOn ?? true,
      camOn: camOn ?? true
    };

    // peers list
    const peers = Object.entries(rooms[roomId])
      .filter(([id]) => id !== socket.id)
      .map(([id, data]) => ({
        id,
        name: data.name
      }));

    // send joined (frontend expects this)
    socket.emit("joined", {
      isHost: peers.length === 0,
      peers
    });

    // notify others
    socket.to(roomId).emit("peer-joined", {
      id: socket.id,
      name
    });
  });

  // =========================
  // MEDIA STATE SYNC
  // =========================
  socket.on("media-state", ({ roomId, micOn, camOn }) => {
    if (!rooms[roomId]) return;
    if (!rooms[roomId][socket.id]) return;

    rooms[roomId][socket.id].micOn = micOn;
    rooms[roomId][socket.id].camOn = camOn;

    socket.to(roomId).emit("peer-media-state", {
      id: socket.id,
      micOn,
      camOn
    });
  });

  // =========================
  // CHAT
  // =========================
  socket.on("chat-message", ({ roomId, text, name }) => {
    if (!roomId) return;

    socket.to(roomId).emit("chat-message", {
      from: socket.id,
      name,
      text,
      time: new Date().toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit"
      })
    });
  });

  // =========================
  // WEBRTC SIGNALING (UNCHANGED)
  // =========================
  socket.on("offer", ({ to, sdp }) => {
    io.to(to).emit("offer", {
      from: socket.id,
      sdp
    });
  });

  socket.on("answer", ({ to, sdp }) => {
    io.to(to).emit("answer", {
      from: socket.id,
      sdp
    });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  // =========================
  // SCREEN SHARE
  // =========================
  socket.on("screen-share-started", ({ roomId }) => {
    socket.to(roomId).emit("peer-screen-share", {
      id: socket.id,
      active: true
    });
  });

  socket.on("screen-share-stopped", ({ roomId }) => {
    socket.to(roomId).emit("peer-screen-share", {
      id: socket.id,
      active: false
    });
  });

  // =========================
  // DISCONNECT (FIXED SAFE)
  // =========================
  socket.on("disconnect", () => {

    const roomId = socket.data.roomId;
    if (!roomId) return;

    if (rooms[roomId]) {

      delete rooms[roomId][socket.id];

      socket.to(roomId).emit("peer-left", {
        id: socket.id
      });

      if (Object.keys(rooms[roomId]).length === 0) {
        delete rooms[roomId];
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Joinly running on port ${PORT}`);
});
