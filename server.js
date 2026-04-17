// ═══════════════════════════════════════════════
// Joinly Server (Render + Socket.IO + WebRTC)
// ═══════════════════════════════════════════════

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// 🔥 PORT (Render uyumlu)
const PORT = process.env.PORT || 3000;

// 📁 Frontend serve et
app.use(express.static(path.join(__dirname, "public")));

// 🏠 Ana sayfa
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "joinly.html"));
});

// ======================
// ROOMS
// ======================
const rooms = {};

// ======================
// SOCKET
// ======================
io.on("connection", (socket) => {
  let currentRoom = null;

  // 🆕 ODA OLUŞTUR
  socket.on("create-room", ({ roomId, name }) => {
    if (rooms[roomId]) {
      socket.emit("error", "Room already exists");
      return;
    }

    rooms[roomId] = { users: {} };

    currentRoom = roomId;
    rooms[roomId].users[socket.id] = name;

    socket.join(roomId);

    socket.emit("room-created", roomId);

    io.to(roomId).emit("room-users", rooms[roomId].users);
  });

  // 🚪 ODAYA KATIL
  socket.on("join-room", ({ roomId, name }) => {
    if (!rooms[roomId]) {
      socket.emit("error", "Room not found");
      return;
    }

    currentRoom = roomId;

    rooms[roomId].users[socket.id] = name;

    socket.join(roomId);

    // odadakilere bildir
    socket.to(roomId).emit("user-joined", {
      id: socket.id,
      name
    });

    // kullanıcıya oda bilgisi
    socket.emit("room-users", rooms[roomId].users);
  });

  // 💬 mesaj
  socket.on("message", ({ roomId, msg, name }) => {
    io.to(roomId).emit("message", {
      id: socket.id,
      name,
      msg
    });
  });

  // 🎥 WebRTC signal
  socket.on("offer", ({ to, sdp }) => {
    io.to(to).emit("offer", { from: socket.id, sdp });
  });

  socket.on("answer", ({ to, sdp }) => {
    io.to(to).emit("answer", { from: socket.id, sdp });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", {
      from: socket.id,
      candidate
    });
  });

  // ❌ disconnect
  socket.on("disconnect", () => {
    if (!currentRoom) return;

    const room = rooms[currentRoom];
    if (!room) return;

    delete room.users[socket.id];

    socket.to(currentRoom).emit("user-left", socket.id);

    if (Object.keys(room.users).length === 0) {
      delete rooms[currentRoom];
    }
  });
});

// ======================
// START SERVER
// ======================
server.listen(PORT, () => {
  console.log(`🚀 Joinly running on port ${PORT}`);
});
