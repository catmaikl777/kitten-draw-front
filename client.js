class DrawingApp {
    constructor() {
        // URL бэкенда на Render
        this.BACKEND_URL = 'https://kitten-draw.onrender.com';
        this.socket = null;
        this.roomId = null;
        this.playerId = null;
        this.username = null;
        this.players = new Map();
        
        // Настройки рисования
        this.currentTool = 'brush';
        this.currentColor = '#FF5252';
        this.brushSize = 5;
        this.isDrawing = false;
        this.lastX = 0;
        this.lastY = 0;
        this.startX = 0;
        this.startY = 0;
        
        // Элементы DOM
        this.canvas = document.getElementById('drawingCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.overlay = document.getElementById('canvasOverlay');
        this.overlayCtx = this.overlay.getContext('2d');
        
        this.history = [];
        this.historyIndex = -1;
        
        this.init();
    }

    async init() {
        await this.checkBackendStatus();
        this.setupEventListeners();
        this.initCanvas();
        this.connectSocket();
    }

    async checkBackendStatus() {
        try {
            const response = await fetch(`${this.BACKEND_URL}/health`);
            const data = await response.json();
            
            document.getElementById('backendStatus').textContent = '✅ Бэкенд доступен';
            document.getElementById('backendStatus').className = 'backend-success';
            
        } catch (error) {
            console.error('Backend is not available:', error);
            document.getElementById('backendStatus').textContent = '❌ Бэкенд недоступен';
            document.getElementById('backendStatus').className = 'backend-error';
        }
    }

    connectSocket() {
        console.log('Connecting to backend:', this.BACKEND_URL);
        
        this.socket = io(this.BACKEND_URL, {
            transports: ['websocket', 'polling'],
            timeout: 10000
        });

        this.socket.on('connect', () => {
            console.log('✅ Connected to backend');
            this.updateStatus('Подключено к серверу', 'connected');
        });

        this.socket.on('disconnect', (reason) => {
            console.log('❌ Disconnected from backend:', reason);
            this.updateStatus('Отключено от сервера', 'disconnected');
        });

        this.socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            this.updateStatus('Ошибка подключения', 'disconnected');
        });

        // Обработчики событий
        this.socket.on('room_joined', (data) => {
            this.handleRoomJoined(data);
        });

        this.socket.on('player_joined', (data) => {
            this.handlePlayerJoined(data);
        });

        this.socket.on('player_left', (data) => {
            this.handlePlayerLeft(data);
        });

        this.socket.on('draw', (data) => {
            this.handleRemoteDraw(data);
        });

        this.socket.on('clear', (data) => {
            this.clearCanvas();
        });

        this.socket.on('chat_message', (data) => {
            this.displayChatMessage(data);
        });

        this.socket.on('error', (data) => {
            this.showError(data.message);
        });
    }

    setupEventListeners() {
        // Кнопки создания/присоединения к комнате
        document.getElementById('createRoomBtn').addEventListener('click', () => this.createRoom());
        document.getElementById('joinRoomBtn').addEventListener('click', () => this.joinRoom());
        document.getElementById('leaveRoomBtn').addEventListener('click', () => this.leaveRoom());
        
        // Инструменты
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectTool(e.currentTarget.dataset.tool));
        });
        
        // Настройки кисти
        document.getElementById('brushSizeSlider').addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value);
            document.getElementById('brushSizeValue').textContent = this.brushSize;
        });
        
        // Цвета
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => this.selectColor(e.target.dataset.color));
        });
        
        // Действия
        document.getElementById('clearBtn').addEventListener('click', () => this.requestClearCanvas());
        document.getElementById('saveBtn').addEventListener('click', () => this.saveDrawing());
        document.getElementById('undoBtn').addEventListener('click', () => this.undo());
        document.getElementById('copyInviteBtn').addEventListener('click', () => this.copyInviteCode());
        
        // Чат
        document.getElementById('sendMessageBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // События холста
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());
        this.canvas.addEventListener('touchstart', (e) => this.handleTouch(e));
        this.canvas.addEventListener('touchmove', (e) => this.handleTouch(e));
        this.canvas.addEventListener('touchend', () => this.stopDrawing());
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        
        // Адаптивный размер
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    async createRoom() {
        const username = document.getElementById('usernameInput').value.trim() || 'Аноним';
        this.username = username;
        
        try {
            const response = await fetch(`${this.BACKEND_URL}/api/rooms`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.joinRoom(data.roomId);
            } else {
                this.showError('Ошибка при создании комнаты');
            }
        } catch (error) {
            console.error('Error creating room:', error);
            this.showError('Не удалось создать комнату. Проверьте подключение.');
        }
    }

    async joinRoom(roomId = null) {
        const username = document.getElementById('usernameInput').value.trim() || 'Аноним';
        const roomCode = roomId || document.getElementById('roomCodeInput').value.trim().toUpperCase();
        
        if (!roomCode) {
            this.showError('Введите код комнаты');
            return;
        }

        // Проверяем существование комнаты
        try {
            const response = await fetch(`${this.BACKEND_URL}/api/rooms/${roomCode}`);
            const data = await response.json();
            
            if (!data.exists && roomId) {
                // Если комната не существует при создании, это нормально
                console.log('Creating new room...');
            } else if (!data.exists) {
                this.showError('Комната не найдена');
                return;
            } else if (data.players >= 2) {
                this.showError('Комната заполнена (максимум 2 игрока)');
                return;
            }
        } catch (error) {
            console.error('Error checking room:', error);
            // Продолжаем попытку подключения
        }

        this.username = username;
        this.roomId = roomCode;
        
        // Подключаемся к сокету если еще не подключены
        if (!this.socket || !this.socket.connected) {
            this.connectSocket();
        }
        
        // Ждем подключения
        if (this.socket.connected) {
            this.doJoinRoom();
        } else {
            this.socket.once('connect', () => {
                this.doJoinRoom();
            });
        }
    }

    doJoinRoom() {
        this.socket.emit('join_room', {
            roomId: this.roomId,
            username: this.username
        });
    }

    handleRoomJoined(data) {
        this.roomId = data.roomId;
        this.playerId = data.playerId;
        
        // Переключаем экраны
        document.getElementById('loginScreen').classList.remove('active');
        document.getElementById('mainScreen').classList.add('active');
        
        // Обновляем UI
        document.getElementById('roomCodeDisplay').textContent = this.roomId;
        document.getElementById('inviteCode').textContent = this.roomId;
        
        // Обновляем информацию об игроках
        this.players.clear();
        data.players.forEach(player => {
            this.players.set(player.id, player);
            this.updatePlayerDisplay(player.id, player);
        });
        
        this.updatePlayersCount();
        
        // Восстанавливаем холст если есть данные
        if (data.canvasData) {
            const img = new Image();
            img.onload = () => {
                this.ctx.drawImage(img, 0, 0);
            };
            img.src = data.canvasData;
        }
        
        this.addSystemMessage(`Вы присоединились к комнате как ${this.username}`);
    }

    handlePlayerJoined(data) {
        this.players.set(data.player.id, data.player);
        this.updatePlayerDisplay(data.player.id, data.player);
        this.updatePlayersCount();
        this.addSystemMessage(`${data.player.username} присоединился к комнате`);
    }

    handlePlayerLeft(data) {
        this.players.delete(data.playerId);
        this.updatePlayerDisplay(data.playerId, null);
        this.updatePlayersCount();
        this.addSystemMessage('Игрок покинул комнату');
    }

    updatePlayerDisplay(playerId, player) {
        const elementId = `player${playerId}Name`;
        const element = document.getElementById(elementId);
        
        if (element) {
            if (player) {
                element.textContent = player.username;
                if (playerId === 1) {
                    element.parentElement.querySelector('.owner-badge').style.display = 'inline';
                }
            } else {
                element.textContent = playerId === 1 ? 'Игрок 1' : 'Ожидание...';
                if (playerId === 1) {
                    element.parentElement.querySelector('.owner-badge').style.display = 'none';
                }
            }
        }
    }

    updatePlayersCount() {
        const count = this.players.size;
        document.getElementById('playersCount').textContent = `${count}/2`;
    }

    selectTool(tool) {
        this.currentTool = tool;
        
        // Обновляем UI
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tool="${tool}"]`).classList.add('active');
        
        // Меняем курсор
        this.canvas.style.cursor = tool === 'brush' ? 'crosshair' : 
                                 tool === 'eraser' ? 'cell' : 'crosshair';
    }

    selectColor(color) {
        this.currentColor = color;
        
        // Обновляем UI
        document.querySelectorAll('.color-option').forEach(option => {
            option.classList.remove('active');
        });
        document.querySelector(`[data-color="${color}"]`).classList.add('active');
    }

    startDrawing(e) {
        if (!this.roomId || !this.socket?.connected) return;
        
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        this.startX = this.lastX = (e.clientX - rect.left) * scaleX;
        this.startY = this.lastY = (e.clientY - rect.top) * scaleY;
        this.isDrawing = true;
        
        if (this.currentTool === 'brush') {
            this.ctx.beginPath();
            this.ctx.moveTo(this.lastX, this.lastY);
        }
        
        this.saveToHistory();
    }

    draw(e) {
        if (!this.isDrawing || !this.roomId || !this.socket?.connected) return;
        
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        
        const currentX = (e.clientX - rect.left) * scaleX;
        const currentY = (e.clientY - rect.top) * scaleY;
        
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        
        switch (this.currentTool) {
            case 'brush':
                this.drawBrush(currentX, currentY);
                break;
            case 'eraser':
                this.drawEraser(currentX, currentY);
                break;
            case 'line':
            case 'rectangle':
            case 'circle':
                this.drawShapePreview(currentX, currentY);
                break;
        }
        
        this.lastX = currentX;
        this.lastY = currentY;
    }

    drawBrush(x, y) {
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.brushSize;
        
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        
        this.sendDrawData([[this.lastX, this.lastY], [x, y]]);
    }

    drawEraser(x, y) {
        this.ctx.strokeStyle = 'white';
        this.ctx.lineWidth = this.brushSize;
        
        this.ctx.lineTo(x, y);
        this.ctx.stroke();
        
        this.sendDrawData([[this.lastX, this.lastY], [x, y]], 'white');
    }

    drawShapePreview(x, y) {
        // Очищаем overlay
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        this.overlayCtx.strokeStyle = this.currentColor;
        this.overlayCtx.lineWidth = this.brushSize;
        this.overlayCtx.setLineDash([5, 5]);
        
        switch (this.currentTool) {
            case 'line':
                this.overlayCtx.beginPath();
                this.overlayCtx.moveTo(this.startX, this.startY);
                this.overlayCtx.lineTo(x, y);
                this.overlayCtx.stroke();
                break;
            case 'rectangle':
                const rectWidth = x - this.startX;
                const rectHeight = y - this.startY;
                this.overlayCtx.strokeRect(this.startX, this.startY, rectWidth, rectHeight);
                break;
            case 'circle':
                const radius = Math.sqrt(Math.pow(x - this.startX, 2) + Math.pow(y - this.startY, 2));
                this.overlayCtx.beginPath();
                this.overlayCtx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
                this.overlayCtx.stroke();
                break;
        }
        
        this.overlayCtx.setLineDash([]);
    }

    stopDrawing() {
        if (!this.isDrawing) return;
        
        this.isDrawing = false;
        this.ctx.beginPath();
        
        // Завершаем рисование фигуры
        if (['line', 'rectangle', 'circle'].includes(this.currentTool)) {
            this.finalizeShape();
        }
        
        // Очищаем overlay
        this.overlayCtx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    }

    finalizeShape() {
        const currentX = this.lastX;
        const currentY = this.lastY;
        
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.brushSize;
        
        switch (this.currentTool) {
            case 'line':
                this.ctx.beginPath();
                this.ctx.moveTo(this.startX, this.startY);
                this.ctx.lineTo(currentX, currentY);
                this.ctx.stroke();
                this.sendDrawData([[this.startX, this.startY], [currentX, currentY]], null, 'line');
                break;
            case 'rectangle':
                const rectWidth = currentX - this.startX;
                const rectHeight = currentY - this.startY;
                this.ctx.strokeRect(this.startX, this.startY, rectWidth, rectHeight);
                this.sendDrawData([[this.startX, this.startY], [currentX, currentY]], null, 'rectangle');
                break;
            case 'circle':
                const radius = Math.sqrt(Math.pow(currentX - this.startX, 2) + Math.pow(currentY - this.startY, 2));
                this.ctx.beginPath();
                this.ctx.arc(this.startX, this.startY, radius, 0, Math.PI * 2);
                this.ctx.stroke();
                this.sendDrawData([[this.startX, this.startY], [currentX, currentY]], null, 'circle');
                break;
        }
    }

    handleTouch(e) {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        
        if (e.type === 'touchstart') {
            this.startDrawing(mouseEvent);
        } else if (e.type === 'touchmove') {
            this.draw(mouseEvent);
        }
    }

    sendDrawData(points, color = null, tool = null) {
        if (!this.roomId || !this.socket?.connected) return;
        
        this.socket.emit('draw', {
            playerId: this.playerId,
            points: points,
            color: color || this.currentColor,
            brushSize: this.brushSize,
            tool: tool || this.currentTool,
            canvasData: this.canvas.toDataURL()
        });
    }

    handleRemoteDraw(data) {
        const points = data.points;
        const color = data.color;
        const brushSize = data.brushSize;
        const tool = data.tool;
        
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = brushSize;
        this.ctx.lineJoin = 'round';
        this.ctx.lineCap = 'round';
        
        if (tool === 'brush' || tool === 'eraser') {
            this.ctx.beginPath();
            this.ctx.moveTo(points[0][0], points[0][1]);
            this.ctx.lineTo(points[1][0], points[1][1]);
            this.ctx.stroke();
        } else if (tool === 'line') {
            this.ctx.beginPath();
            this.ctx.moveTo(points[0][0], points[0][1]);
            this.ctx.lineTo(points[1][0], points[1][1]);
            this.ctx.stroke();
        } else if (tool === 'rectangle') {
            const startX = points[0][0];
            const startY = points[0][1];
            const endX = points[1][0];
            const endY = points[1][1];
            this.ctx.strokeRect(startX, startY, endX - startX, endY - startY);
        } else if (tool === 'circle') {
            const startX = points[0][0];
            const startY = points[0][1];
            const endX = points[1][0];
            const endY = points[1][1];
            const radius = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
            this.ctx.beginPath();
            this.ctx.arc(startX, startY, radius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    requestClearCanvas() {
        if (!this.roomId || !this.socket?.connected) return;
        
        if (confirm('Вы уверены, что хотите очистить холст?')) {
            this.clearCanvas();
            this.socket.emit('clear', {
                playerId: this.playerId
            });
        }
    }

    clearCanvas() {
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.history = [];
        this.historyIndex = -1;
        this.updateUndoButton();
    }

    saveDrawing() {
        const link = document.createElement('a');
        link.download = `рисунок-${this.roomId}-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = this.canvas.toDataURL('image/png');
        link.click();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const imageData = this.history[this.historyIndex];
            this.ctx.putImageData(imageData, 0, 0);
            this.updateUndoButton();
            
            // Синхронизируем с другими игроками
            if (this.socket?.connected) {
                this.socket.emit('draw', {
                    playerId: this.playerId,
                    canvasData: this.canvas.toDataURL(),
                    isUndo: true
                });
            }
        }
    }

    saveToHistory() {
        // Сохраняем только последние 20 действий
        if (this.history.length >= 20) {
            this.history.shift();
        }
        
        this.historyIndex = this.history.length;
        this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
        this.updateUndoButton();
    }

    updateUndoButton() {
        const undoBtn = document.getElementById('undoBtn');
        undoBtn.disabled = this.historyIndex <= 0;
    }

    sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (!message || !this.roomId || !this.socket?.connected) return;
        
        this.socket.emit('chat_message', {
            playerId: this.playerId,
            username: this.username,
            message: message
        });
        
        input.value = '';
    }

    displayChatMessage(data) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        
        messageDiv.className = `chat-message ${data.playerId === this.playerId ? 'own' : ''}`;
        
        if (data.playerId === 'system') {
            messageDiv.className = 'chat-message system';
            messageDiv.innerHTML = `<div class="message-text">${data.message}</div>`;
        } else {
            messageDiv.innerHTML = `
                <div class="message-sender">${data.username}</div>
                <div class="message-text">${data.message}</div>
            `;
        }
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    addSystemMessage(message) {
        this.displayChatMessage({
            playerId: 'system',
            username: 'Система',
            message: message
        });
    }

    leaveRoom() {
        if (this.roomId) {
            if (this.socket) {
                this.socket.disconnect();
            }
            
            this.roomId = null;
            this.playerId = null;
            this.players.clear();
            
            document.getElementById('mainScreen').classList.remove('active');
            document.getElementById('loginScreen').classList.add('active');
            
            this.clearCanvas();
            this.connectSocket(); // Переподключаемся для новой комнаты
        }
    }

    copyInviteCode() {
        if (this.roomId) {
            navigator.clipboard.writeText(this.roomId).then(() => {
                this.addSystemMessage('Код комнаты скопирован в буфер обмена');
            }).catch(() => {
                // Fallback для старых браузеров
                const tempInput = document.createElement('input');
                tempInput.value = this.roomId;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
                this.addSystemMessage('Код комнаты скопирован в буфер обмена');
            });
        }
    }

    initCanvas() {
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.resizeCanvas();
    }

    resizeCanvas() {
        const container = this.canvas.parentElement;
        const width = container.clientWidth;
        const height = Math.min(500, width * 0.625);
        
        this.canvas.width = width;
        this.canvas.height = height;
        
        this.overlay.width = width;
        this.overlay.height = height;
        
        // Перерисовываем если есть данные
        if (this.ctx.getImageData(0, 0, 1, 1).data[3] !== 0) {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = width;
            tempCanvas.height = height;
            tempCtx.drawImage(this.canvas, 0, 0, width, height);
            this.initCanvas();
            this.ctx.drawImage(tempCanvas, 0, 0);
        } else {
            this.initCanvas();
        }
    }

    updateStatus(text, className) {
        const statusElement = document.getElementById('status');
        statusElement.textContent = text;
        statusElement.className = className;
    }

    showError(message) {
        alert(`Ошибка: ${message}`);
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    window.drawingApp = new DrawingApp();
});

// Глобальные функции для отладки
window.getAppState = () => {
    return {
        roomId: window.drawingApp.roomId,
        playerId: window.drawingApp.playerId,
        username: window.drawingApp.username,
        socketConnected: window.drawingApp.socket?.connected,
        players: Array.from(window.drawingApp.players.values())
    };
};
