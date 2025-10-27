class CollaborativeDrawingApp {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.playerId = null;
        this.playerNumber = null;
        this.players = {};
        
        this.canvas = document.getElementById('mainCanvas');
        this.tempCanvas = document.getElementById('tempCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.tempCtx = this.tempCanvas.getContext('2d');
        
        this.isDrawing = false;
        this.currentTool = 'brush';
        this.currentColor = '#000000';
        this.brushSize = 5;
        this.lastX = 0;
        this.lastY = 0;
        
        this.drawingHistory = [];
        this.historyIndex = -1;
        
        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupEventListeners();
        this.setupSocket();
    }

    setupSocket() {
        // Подключаемся к WebSocket серверу
        this.socket = io('https://kitten-draw.onrender.com');
        
        this.socket.on('connect', () => {
            console.log('Подключено к серверу');
            this.updateConnectionStatus('Подключено');
        });
        
        this.socket.on('disconnect', () => {
            console.log('Отключено от сервера');
            this.updateConnectionStatus('Отключено');
        });
        
        this.socket.on('error', (data) => {
            console.error('Ошибка:', data.message);
            alert('Ошибка: ' + data.message);
        });
        
        // Обработчики событий комнаты
        this.socket.on('roomCreated', (data) => {
            this.handleRoomCreated(data);
        });
        
        this.socket.on('roomJoined', (data) => {
            this.handleRoomJoined(data);
        });
        
        this.socket.on('playerJoined', (data) => {
            this.handlePlayerJoined(data);
        });
        
        this.socket.on('playerLeft', (data) => {
            this.handlePlayerLeft(data);
        });
        
        // Обработчики рисования
        this.socket.on('drawingData', (data) => {
            this.handleRemoteDrawing(data);
        });
        
        this.socket.on('clearCanvas', (data) => {
            this.handleRemoteClearCanvas(data);
        });
        
        this.socket.on('undo', (data) => {
            this.handleRemoteUndo(data);
        });
        
        this.socket.on('redo', (data) => {
            this.handleRemoteRedo(data);
        });
        
        // Обработчики чата
        this.socket.on('chatMessage', (data) => {
            this.handleChatMessage(data);
        });
        
        // Пинг для проверки соединения
        setInterval(() => {
            if (this.socket.connected) {
                this.socket.emit('ping');
            }
        }, 30000);
    }

    setupCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth - 40;
        this.canvas.height = container.clientHeight - 40;
        this.tempCanvas.width = this.canvas.width;
        this.tempCanvas.height = this.canvas.height;
        
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        this.ctx.lineWidth = this.brushSize;
        this.ctx.strokeStyle = this.currentColor;
        
        this.tempCtx.lineJoin = 'round';
        this.tempCtx.lineCap = 'round';
        
        this.clearCanvas();
    }

    setupEventListeners() {
        // События подключения
        document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
        document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
        document.getElementById('copyCodeBtn').addEventListener('click', () => this.copyRoomCode());
        document.getElementById('leaveRoomBtn').addEventListener('click', () => this.leaveRoom());

        // События рисования
        this.canvas.addEventListener('mousedown', this.startDrawing.bind(this));
        this.canvas.addEventListener('mousemove', this.draw.bind(this));
        this.canvas.addEventListener('mouseup', this.stopDrawing.bind(this));
        this.canvas.addEventListener('mouseout', this.stopDrawing.bind(this));

        // Touch события
        this.canvas.addEventListener('touchstart', this.handleTouch.bind(this));
        this.canvas.addEventListener('touchmove', this.handleTouch.bind(this));
        this.canvas.addEventListener('touchend', this.stopDrawing.bind(this));

        // Инструменты
        document.getElementById('brushTool').addEventListener('click', () => this.setTool('brush'));
        document.getElementById('eraserTool').addEventListener('click', () => this.setTool('eraser'));
        document.getElementById('clearCanvasBtn').addEventListener('click', () => this.clearCanvas());

        // Настройки
        document.getElementById('colorPicker').addEventListener('change', (e) => {
            this.currentColor = e.target.value;
            this.ctx.strokeStyle = this.currentColor;
        });

        document.getElementById('brushSize').addEventListener('input', (e) => {
            this.brushSize = e.target.value;
            this.ctx.lineWidth = this.brushSize;
            document.getElementById('brushSizeValue').textContent = this.brushSize + 'px';
        });

        // Действия
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('redoBtn').addEventListener('click', () => this.redo());
        document.getElementById('saveImageBtn').addEventListener('click', () => this.saveImage());

        // Чат
        document.getElementById('sendMessageBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });

        // Позиция курсора
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = Math.round(e.clientX - rect.left);
            const y = Math.round(e.clientY - rect.top);
            document.getElementById('cursorPosition').textContent = `X: ${x}, Y: ${y}`;
        });

        // Адаптация к размеру окна
        window.addEventListener('resize', () => {
            setTimeout(() => this.setupCanvas(), 100);
        });
    }

    // === УПРАВЛЕНИЕ КОМНАТАМИ ===
    createRoom() {
        this.socket.emit('createRoom');
    }

    joinRoom() {
        const codeInput = document.getElementById('roomCodeInput');
        const roomCode = codeInput.value.trim().toUpperCase();
        
        if (roomCode.length !== 6) {
            alert('Код комнаты должен состоять из 6 символов');
            return;
        }

        this.socket.emit('joinRoom', { roomCode });
    }

    handleRoomCreated(data) {
        this.roomCode = data.roomCode;
        this.playerId = data.playerId;
        this.playerNumber = data.playerNumber;
        
        this.players[data.playerId] = {
            id: data.playerId,
            name: 'Игрок 1',
            number: 1,
            online: true
        };

        this.showRoomInfo();
        this.showDrawingScreen();
    }

    handleRoomJoined(data) {
        this.roomCode = data.roomCode;
        this.playerId = data.playerId;
        this.playerNumber = data.playerNumber;
        
        // Обновляем список игроков
        this.players = {};
        data.roomPlayers.forEach(player => {
            this.players[player.id] = {
                ...player,
                online: true
            };
        });

        this.showDrawingScreen();
        this.addSystemMessage('Вы присоединились к комнате');
    }

    handlePlayerJoined(data) {
        this.players[data.playerId] = {
            id: data.playerId,
            name: data.playerName,
            number: data.playerNumber,
            online: true
        };
        
        this.updatePlayersDisplay();
        this.addSystemMessage(`${data.playerName} присоединился к комнате`);
    }

    handlePlayerLeft(data) {
        if (this.players[data.playerId]) {
            this.players[data.playerId].online = false;
            this.addSystemMessage(`${data.playerName} покинул комнату`);
            this.updatePlayersDisplay();
        }
    }

    showRoomInfo() {
        document.getElementById('roomInfo').style.display = 'block';
        document.getElementById('roomCodeDisplay').textContent = this.roomCode;
    }

    showDrawingScreen() {
        document.getElementById('connectionScreen').classList.remove('active');
        document.getElementById('drawingScreen').classList.add('active');
        document.getElementById('currentRoomCode').textContent = this.roomCode;
        
        this.updatePlayersDisplay();
        this.addSystemMessage('Добро пожаловать в совместную рисовалку!');
    }

    leaveRoom() {
        if (this.socket && this.roomCode) {
            this.socket.emit('leaveRoom', { roomCode: this.roomCode });
        }
        
        this.roomCode = null;
        this.playerId = null;
        this.playerNumber = null;
        this.players = {};
        
        document.getElementById('drawingScreen').classList.remove('active');
        document.getElementById('connectionScreen').classList.add('active');
        document.getElementById('roomInfo').style.display = 'none';
        document.getElementById('roomCodeInput').value = '';
        
        this.clearCanvas();
    }

    copyRoomCode() {
        navigator.clipboard.writeText(this.roomCode).then(() => {
            alert('Код комнаты скопирован!');
        });
    }

    // === РИСОВАНИЕ ===
    startDrawing(e) {
        if (!this.roomCode) return;
        
        this.isDrawing = true;
        this.saveState();
        
        const pos = this.getMousePos(e);
        this.lastX = pos.x;
        this.lastY = pos.y;
        
        this.ctx.beginPath();
        this.ctx.moveTo(this.lastX, this.lastY);
    }

    stopDrawing() {
        if (!this.isDrawing) return;
        
        this.isDrawing = false;
        this.ctx.beginPath();
    }

    draw(e) {
        if (!this.isDrawing || !this.roomCode) return;

        const pos = this.getMousePos(e);
        const x = pos.x;
        const y = pos.y;

        // Рисуем на основном canvas
        this.ctx.lineWidth = this.brushSize;
        this.ctx.strokeStyle = this.currentColor;

        if (this.currentTool === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out';
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
        }

        this.ctx.lineTo(x, y);
        this.ctx.stroke();

        // Отправляем данные рисования другим игрокам
        this.socket.emit('drawingData', {
            roomCode: this.roomCode,
            drawingData: {
                type: 'drawing',
                tool: this.currentTool,
                color: this.currentColor,
                size: this.brushSize,
                fromX: this.lastX,
                fromY: this.lastY,
                toX: x,
                toY: y
            }
        });

        this.lastX = x;
        this.lastY = y;
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;

        if (e.type.includes('touch')) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }

        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    handleTouch(e) {
        e.preventDefault();
        if (e.type === 'touchstart') {
            this.startDrawing(e);
        } else if (e.type === 'touchmove') {
            this.draw(e);
        }
    }

    setTool(tool) {
        this.currentTool = tool;
        
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');

        if (tool === 'eraser') {
            this.canvas.style.cursor = 'cell';
        } else {
            this.canvas.style.cursor = 'crosshair';
        }
    }

    clearCanvas() {
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.beginPath();
        
        if (this.roomCode) {
            this.socket.emit('clearCanvas', { roomCode: this.roomCode });
        }
        
        this.saveState();
    }

    // === ОБРАБОТКА УДАЛЕННЫХ СОБЫТИЙ ===
    handleRemoteDrawing(data) {
        const drawingData = data.drawingData;
        
        this.ctx.strokeStyle = drawingData.color;
        this.ctx.lineWidth = drawingData.size;
        this.ctx.globalCompositeOperation = drawingData.tool === 'eraser' ? 'destination-out' : 'source-over';
        
        this.ctx.beginPath();
        this.ctx.moveTo(drawingData.fromX, drawingData.fromY);
        this.ctx.lineTo(drawingData.toX, drawingData.toY);
        this.ctx.stroke();
        
        this.ctx.globalCompositeOperation = 'source-over';
    }

    handleRemoteClearCanvas() {
        this.clearCanvas();
    }

    handleRemoteUndo() {
        this.undo();
    }

    handleRemoteRedo() {
        this.redo();
    }

    // === ИСТОРИЯ ДЕЙСТВИЙ ===
    saveState() {
        this.drawingHistory = this.drawingHistory.slice(0, this.historyIndex + 1);
        this.drawingHistory.push(this.canvas.toDataURL());
        this.historyIndex = this.drawingHistory.length - 1;
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.restoreState();
            
            if (this.roomCode) {
                this.socket.emit('undo', { roomCode: this.roomCode });
            }
        }
    }

    redo() {
        if (this.historyIndex < this.drawingHistory.length - 1) {
            this.historyIndex++;
            this.restoreState();
            
            if (this.roomCode) {
                this.socket.emit('redo', { roomCode: this.roomCode });
            }
        }
    }

    restoreState() {
        const img = new Image();
        img.onload = () => {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.drawImage(img, 0, 0);
        };
        img.src = this.drawingHistory[this.historyIndex];
    }

    // === ЧАТ ===
    sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (message && this.roomCode) {
            this.addChatMessage(message, `Игрок ${this.playerNumber}`, true);
            this.socket.emit('chatMessage', {
                roomCode: this.roomCode,
                message: message
            });
            input.value = '';
        }
    }

    handleChatMessage(data) {
        const isOwn = data.playerId === this.playerId;
        this.addChatMessage(data.message, data.playerName, isOwn);
    }

    addChatMessage(message, playerName, isOwn = false) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
        messageDiv.innerHTML = `
            <strong>${playerName}:</strong> ${message}
        `;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    addSystemMessage(message) {
        const chatMessages = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message system';
        messageDiv.textContent = message;
        
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // === UI ОБНОВЛЕНИЯ ===
    updatePlayersDisplay() {
        const player1Indicator = document.querySelector('.player-1-indicator');
        const player2Indicator = document.querySelector('.player-2-indicator');
        
        const onlinePlayers = Object.values(this.players).filter(p => p.online);
        
        // Игрок 1
        const player1 = onlinePlayers.find(p => p.number === 1);
        player1Indicator.querySelector('span').textContent = player1 ? 'Игрок 1' : 'Ожидание...';
        player1Indicator.classList.toggle('active', !!player1);
        player1Indicator.querySelector('.status-dot').className = 
            player1 ? 'status-dot' : 'status-dot offline';
        
        // Игрок 2
        const player2 = onlinePlayers.find(p => p.number === 2);
        player2Indicator.querySelector('span').textContent = player2 ? 'Игрок 2' : 'Ожидание...';
        player2Indicator.classList.toggle('active', !!player2);
        player2Indicator.querySelector('.status-dot').className = 
            player2 ? 'status-dot' : 'status-dot offline';
        
        document.getElementById('onlineCount').textContent = `Игроков онлайн: ${onlinePlayers.length}`;
    }

    updateConnectionStatus(status) {
        document.getElementById('connectionStatus').textContent = status;
    }

    // === СОХРАНЕНИЕ ===
    saveImage() {
        const link = document.createElement('a');
        link.download = `совместный-рисунок-${this.roomCode || 'unknown'}.png`;
        link.href = this.canvas.toDataURL();
        link.click();
    }
}

// Инициализация приложения
const app = new CollaborativeDrawingApp();