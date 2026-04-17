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

// ======================
// STATIC FRONTEND
// ======================
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "joinly.html"));
});

// ======================
// ROOMS STATE
// ======================
const rooms = {};

// ======================
// SOCKET.IO
// ======================
io.on("connection", (socket) => {

  // ======================
  // JOIN ROOM (WAITING SYSTEM)
  // ======================
  socket.on("join-room", ({ roomId, name, micOn, camOn }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: {},
        waiting: {}
      };
    }

    const room = rooms[roomId];
    socket.join(roomId);

    // waiting list
    room.waiting[socket.id] = {
      id: socket.id,
      name,
      micOn: micOn ?? true,
      camOn: camOn ?? true
    };

    const isHost = Object.keys(room.users).length === 0;

    socket.emit("waiting", {
      message: "Host onayı bekleniyor..."
    });

    socket.to(roomId).emit("waiting-user", {
      socketId: socket.id,
      name
    });

    if (isHost) {
      socket.emit("you-are-host");
    }
  });

  // ======================
  // ADMIT USER
  // ======================
  socket.on("admit-user", ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || !room.waiting[targetId]) return;

    const user = room.waiting[targetId];
    delete room.waiting[targetId];

    room.users[targetId] = user;

    io.to(targetId).emit("joined", {
      isHost: false,
      peers: Object.values(room.users)
        .filter(u => u.id !== targetId)
        .map(u => ({
          id: u.id,
          name: u.name
        }))
    });

    io.to(roomId).emit("peer-list", Object.values(room.users));
  });

  // ======================
  // DENY USER
  // ======================
  socket.on("deny-user", ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room) return;

    delete room.waiting[targetId];
    io.to(targetId).emit("denied");
  });

  // ======================
  // LEAVE ROOM
  // ======================
  socket.on("leave-room", ({ roomId }) => {
    socket.leave(roomId);
  });

  // ======================
  // MEDIA STATE
  // ======================
  socket.on("media-state", ({ roomId, micOn, camOn }) => {
    const room = rooms[roomId];
    if (!room?.users?.[socket.id]) return;

    room.users[socket.id].micOn = micOn;
    room.users[socket.id].camOn = camOn;

    socket.to(roomId).emit("peer-media-state", {
      id: socket.id,
      micOn,
      camOn
    });
  });

  // ======================
  // CHAT
  // ======================
  socket.on("chat-message", ({ roomId, text, name }) => {
    io.to(roomId).emit("chat-message", {
      from: socket.id,
      name,
      text,
      time: new Date().toLocaleTimeString().slice(0, 5)
    });
  });

  // ======================
  // WEBRTC SIGNALING
  // ======================
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

  // ======================
  // DISCONNECT CLEANUP
  // ======================
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (!room) continue;

      if (room.users[socket.id]) {
        delete room.users[socket.id];
        socket.to(roomId).emit("peer-left", { id: socket.id });
      }

      if (room.waiting?.[socket.id]) {
        delete room.waiting[socket.id];
      }

      if (
        Object.keys(room.users).length === 0 &&
        Object.keys(room.waiting).length === 0
      ) {
        delete rooms[roomId];
      }
    }
  });

});

server.listen(PORT, () => {
  console.log(`🚀 Joinly server running on ${PORT}`);
});
