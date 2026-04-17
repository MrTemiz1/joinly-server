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

  socket.on("join-room", ({ roomId, name, micOn, camOn }) => {
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: {}
      };
    }

    const room = rooms[roomId];

    socket.join(roomId);

    room.users[socket.id] = {
      id: socket.id,
      name,
      micOn: micOn ?? true,
      camOn: camOn ?? true
    };

    // 👑 ilk kişi host
    const isHost = Object.keys(room.users).length === 1;

    // 🔥 FIX: WebRTC başlatıcı
    const initiator = Object.keys(room.users).length === 1;

    // mevcut peer list
    const peers = Object.values(room.users).filter(u => u.id !== socket.id);

    // kullanıcıya kendi bilgisi + mevcut kişiler
    socket.emit("joined", {
      isHost,
      initiator,   // 🔥 EKLENDİ (kritik fix)
      peers: peers.map(p => ({
        id: p.id,
        name: p.name
      }))
    });

    // diğerlerine yeni kişi
    socket.to(roomId).emit("peer-joined", {
      id: socket.id,
      name
    });

    // herkesin listesi
    io.to(roomId).emit("peer-list",
      Object.values(room.users)
    );

    // host bilgisi
    if (isHost) {
      socket.emit("you-are-host");
    }
  });

  // ======================
  // ADMIT / WAITING
  // ======================
  socket.on("admit-user", ({ roomId, targetId, name }) => {
    io.to(targetId).emit("joined", {
      isHost: false,
      peers: []
    });
  });

  socket.on("deny-user", ({ roomId, targetId }) => {
    io.to(targetId).emit("denied");
  });

  socket.on("leave-room", ({ roomId }) => {
    socket.leave(roomId);
  });

  // ======================
  // MEDIA STATE
  // ======================
  socket.on("media-state", ({ roomId, micOn, camOn }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (room.users[socket.id]) {
      room.users[socket.id].micOn = micOn;
      room.users[socket.id].camOn = camOn;
    }

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
  // DISCONNECT
  // ======================
  socket.on("disconnect", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.users[socket.id]) {
        delete room.users[socket.id];

        socket.to(roomId).emit("peer-left", {
          id: socket.id
        });

        if (Object.keys(room.users).length === 0) {
          delete rooms[roomId];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Joinly server running on ${PORT}`);
});
