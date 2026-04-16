 // ════════════════════════════════════════════════════════
//  Joinly — Signaling Server
//  Node.js + Socket.IO  |  WebRTC P2P Mesh (2-4 kişi)
//
//  Kurulum:
//    npm install express socket.io cors
//    node server.js
//
//  .env (isteğe bağlı):
//    PORT=3001
// ════════════════════════════════════════════════════════

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const PORT = process.env.PORT || 3001;

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Statik dosyalar — joinly.html ile aynı klasörde çalıştır
app.use(express.static(path.join(__dirname)));

// ── Oda deposu ──────────────────────────────────────────
// rooms: { [roomId]: { hostId, waitingList: [], peers: { [socketId]: { name, micOn, camOn } } } }
const rooms = {};

function getRoom(roomId) {
  if (!rooms[roomId]) rooms[roomId] = { hostId: null, waitingList: [], peers: {} };
  return rooms[roomId];
}

function cleanRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (Object.keys(room.peers).length === 0) delete rooms[roomId];
}

function broadcastPeerList(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const list = Object.entries(room.peers).map(([id, p]) => ({ id, ...p, isHost: id === room.hostId }));
  io.to(roomId).emit('peer-list', list);
}

// ── Bağlantı ────────────────────────────────────────────
io.on('connection', socket => {
  let currentRoom = null;

  // ─── 1. Odaya katıl isteği ───────────────────────────
  socket.on('join-room', ({ roomId, name, micOn, camOn }) => {
    const room = getRoom(roomId);
    currentRoom = roomId;

    const isHost = Object.keys(room.peers).length === 0;

    if (isHost) {
      // Host direkt girer
      room.hostId = socket.id;
      room.peers[socket.id] = { name, micOn, camOn };
      socket.join(roomId);
      socket.emit('joined', { isHost: true, peers: [] });
      broadcastPeerList(roomId);
    } else {
      // Bekleme odasına ekle
      room.waitingList.push({ socketId: socket.id, name });
      // Host'a bildir
      if (room.hostId) {
        io.to(room.hostId).emit('waiting-user', { socketId: socket.id, name });
      }
      socket.emit('waiting', { message: 'Host onayı bekleniyor...' });
    }
  });

  // ─── 2. Host onayı ───────────────────────────────────
  socket.on('admit-user', ({ roomId, targetId, name, micOn, camOn }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;

    // Bekleme listesinden çıkar
    room.waitingList = room.waitingList.filter(w => w.socketId !== targetId);

    // Odaya ekle
    const targetSocket = io.sockets.sockets.get(targetId);
    if (!targetSocket) return;

    room.peers[targetId] = { name, micOn: true, camOn: true };
    targetSocket.join(roomId);

    // Mevcut peer listesini yeni kişiye gönder
    const existingPeers = Object.entries(room.peers)
      .filter(([id]) => id !== targetId)
      .map(([id, p]) => ({ id, ...p, isHost: id === room.hostId }));

    targetSocket.emit('joined', { isHost: false, peers: existingPeers });

    // Odadakilere yeni kişiyi duyur
    socket.to(roomId).emit('peer-joined', { id: targetId, name, micOn: true, camOn: true, isHost: false });
    broadcastPeerList(roomId);
  });

  // ─── 3. Reddet ───────────────────────────────────────
  socket.on('deny-user', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;
    room.waitingList = room.waitingList.filter(w => w.socketId !== targetId);
    io.to(targetId).emit('denied');
  });

  // ─── 4. WebRTC Signaling ──────────────────────────────
  // offer → belirli peer'a ilet
  socket.on('offer', ({ to, sdp }) => {
    io.to(to).emit('offer', { from: socket.id, sdp });
  });

  socket.on('answer', ({ to, sdp }) => {
    io.to(to).emit('answer', { from: socket.id, sdp });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  // ─── 5. Media durumu değişti ─────────────────────────
  socket.on('media-state', ({ roomId, micOn, camOn }) => {
    const room = rooms[roomId];
    if (!room || !room.peers[socket.id]) return;
    room.peers[socket.id].micOn = micOn;
    room.peers[socket.id].camOn = camOn;
    socket.to(roomId).emit('peer-media-state', { id: socket.id, micOn, camOn });
    broadcastPeerList(roomId);
  });

  // ─── 6. Chat ─────────────────────────────────────────
  socket.on('chat-message', ({ roomId, text, name }) => {
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    io.to(roomId).emit('chat-message', { from: socket.id, name, text, time });
  });

  // ─── 7. Ekran paylaşımı başladı/bitti ────────────────
  socket.on('screen-share-started', ({ roomId }) => {
    socket.to(roomId).emit('peer-screen-share', { id: socket.id, active: true });
  });
  socket.on('screen-share-stopped', ({ roomId }) => {
    socket.to(roomId).emit('peer-screen-share', { id: socket.id, active: false });
  });

  // ─── 8. Host transferi ───────────────────────────────
  socket.on('transfer-host', ({ roomId, targetId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostId) return;
    room.hostId = targetId;
    io.to(roomId).emit('host-changed', { newHostId: targetId });
    broadcastPeerList(roomId);
  });

  // ─── 9. Ayrılma ──────────────────────────────────────
  socket.on('leave-room', ({ roomId }) => handleLeave(roomId));

  socket.on('disconnect', () => {
    if (currentRoom) handleLeave(currentRoom);
  });

  function handleLeave(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    delete room.peers[socket.id];
    socket.leave(roomId);

    // Eğer host ayrıldıysa yeni host ata
    if (room.hostId === socket.id) {
      const remaining = Object.keys(room.peers);
      room.hostId = remaining.length > 0 ? remaining[0] : null;
      if (room.hostId) {
        io.to(room.hostId).emit('you-are-host');
        broadcastPeerList(roomId);
      }
    }

    socket.to(roomId).emit('peer-left', { id: socket.id });
    broadcastPeerList(roomId);
    cleanRoom(roomId);
    currentRoom = null;
  }
});

server.listen(PORT, () => {
  console.log(`\n🎥 Joinly Signaling Server çalışıyor`);
  console.log(`   http://localhost:${PORT}\n`);
});
