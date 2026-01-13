const express = require('express');
const app = express();
const http = require('http');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const axios = require('axios');
const authenticateToken = require('./middleware/auth');
const rateLimit = require('express-rate-limit');
const db = require('./database');

require('dotenv').config();

const config = {
    port: process.env.APP_PORT || 3000,
    env: process.env.APP_ENV || 'dev',
    domain: process.env.APP_DOMAIN,
    name: process.env.APP_NAME || 'WhatsApp Server',
    dev: {
        phone: process.env.DEV_PHONE,
        name: process.env.DEV_NAME,
    },
};

db.initDb();

const whatsapp = require("wa-multi-session");

const server = config.env == 'dev' ? http.createServer(app) : http.createServer(app, {
    key: fs.readFileSync(`/etc/letsencrypt/live/${config.domain}/privkey.pem`),
    cert: fs.readFileSync(`/etc/letsencrypt/live/${config.domain}/fullchain.pem`)
});

const io = require('socket.io')(server, {
    cors: { origin: "*" }
});

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);
app.use(bodyParser.json());
whatsapp.loadSessionsFromStorage();

whatsapp.onDisconnected((sessionId) => {
    console.log(`Sesión desconectada: ${sessionId}`);
    // Agregamos un pequeño retraso para evitar errores de archivos bloqueados
    setTimeout(() => {
        try {
            whatsapp.deleteSession(sessionId);
            console.log(`Sesión y credenciales eliminadas para: ${sessionId}`);
            io.emit('logout', { sessionId });
        } catch (e) {
            console.error(`Error al eliminar la sesión ${sessionId}:`, e.message);
        }
    }, 1000);
});

// Set para rastrear mensajes enviados por el bot y evitar duplicados
const sentBotMessages = new Set();

// ==================== INICIO - LÓGICA DE CHATBOT CON BASE DE DATOS v2 ====================
whatsapp.onMessageReceived(async (msg) => {
    try {
        const user = await db.findOrCreateUser(msg.key.remoteJid);
        const messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;

        // --- INICIO DE LA NUEVA LÓGICA DE ENRUTAMIENTO ---

        // 1. El usuario está en una conversación con un agente (CUANDO EL USUARIO DECIDE CONTACTARSE CON UN AGENTE)
        if (user.state === 'awaiting_agent') {
            await db.updateUserInteractionTime(user.id); // Actualizar para el timeout

            if (msg.key.fromMe) {
                // Es un mensaje del agente (manual)
                if (messageText && !sentBotMessages.has(msg.key.id)) {
                    await db.saveMessage(user.id, messageText, 'manual');
                    console.log(
                        `\n========== MENSAJE DE AGENTE (A USUARIO)GUARDADO (DB) ==========\n` +
                        `A: ${user.phone_number}\n` +
                        `Mensaje: ${messageText}\n` +
                        `==================================================\n`
                    );
                }
            } else {
                // Es un mensaje del usuario para el agente
                if (messageText) {
                    await db.saveMessage(user.id, messageText, 'user');
                    console.log(
                        `\n========== MENSAJE DE USUARIO (A AGENTE) GUARDADO (DB) ==========\n` +
                        `De: ${user.phone_number}\n` +
                        `Mensaje: ${messageText}\n` +
                        `================================================================\n`
                    );
                }
            }
            // Detener la ejecución aquí para que el bot no intervenga
            return;
        }

        // 2. El mensaje es nuestro (fromMe), pero el usuario NO está hablando con un agente (Usuario con Bot o el agente le responde al usuario de manera manual directamente)
        if (msg.key.fromMe) {
            if (!messageText) return;

            if (sentBotMessages.has(msg.key.id)) {
                // Es un eco de una respuesta del bot
                await db.saveMessage(user.id, messageText, 'bot');
                console.log(
                    `\n========== RESPUESTA DE BOT GUARDADA (DB) ==========\n` +
                    `A: ${user.phone_number}\n` +
                    `Mensaje: ${messageText}\n` +
                    `==============================================\n`
                );
                sentBotMessages.delete(msg.key.id);
            } else {
                // Es un mensaje manual, pero el usuario no estaba en modo agente
                await db.saveMessage(user.id, messageText, 'manual');
                console.log(
                    `\n========== MENSAJE MANUAL GUARDADO (DB) ==========\n` +
                    `A: ${user.phone_number}\n` +
                    `Mensaje: ${messageText}\n` +
                    `==============================================\n`
                );
            }
            // Detener la ejecución para mensajes salientes
            return;
        }

        // 3. El mensaje es de un usuario y para el bot (no está en modo agente)
        if (msg.key.remoteJid.endsWith('@g.us')) {
            return; // Ignorar mensajes de grupos
        }

        if (!messageText) {
            return; // Ignorar si no hay texto
        }

        // Guardar mensaje del usuario
        await db.saveMessage(user.id, messageText, 'user');

        console.log(
            `\n========== MENSAJE RECIBIDO (DB) ==========\n` +
            `De: ${user.phone_number} (Estado: ${user.state})\n` +
            `Mensaje: ${messageText}\n` +
            `=========================================\n`
        );

        const lowerCaseMessage = messageText.toLowerCase().trim();
        let responseText = '';

        // Lógica de estado
        if (lowerCaseMessage === 'hola' || lowerCaseMessage === 'menú') {
            responseText = `Hola! 👋 Bienvenido de nuevo. Por favor, elige una opción:\n\n1. Ver saldo\n2. Recargar cuenta\n3. Hablar con un asesor`;
            await db.updateUserState(user.id, 'awaiting_menu_choice');
        }
        else if (user.state === 'awaiting_menu_choice') {
            switch (lowerCaseMessage) {
                case '1':
                    responseText = 'Has elegido "Ver saldo". Tu saldo es de $100.';
                    await db.updateUserState(user.id, 'initial');
                    break;
                case '2':
                    responseText = 'Has elegido "Recargar cuenta". ¿Qué monto deseas recargar?';
                    await db.updateUserState(user.id, 'awaiting_recharge_amount');
                    break;
                case '3':
                    responseText = 'Has elegido "Hablar con un asesor". En breve uno de nuestros agentes te contactará.';
                    await db.updateUserState(user.id, 'awaiting_agent');
                    await db.updateUserInteractionTime(user.id);
                    break;
                default:
                    responseText = 'Opción no válida. Por favor, responde con 1, 2 o 3. Envía "menú" para ver las opciones de nuevo.';
                    break;
            }
        } else if (user.state === 'awaiting_recharge_amount') {
            const amount = parseInt(lowerCaseMessage, 10);
            if (!isNaN(amount) && amount > 0) {
                responseText = `Gracias. Se ha procesado una recarga de ${amount}.`;
                await db.updateUserState(user.id, 'initial');
            } else {
                responseText = 'Monto no válido. Por favor, envía solo el número del monto que deseas recargar (ej. 50).';
            }
        } else {
            responseText = 'No he entendido tu mensaje. Envía "hola" para empezar.';
            await db.updateUserState(user.id, 'initial');
        }

        // // Enviar respuesta y guardarla
        // if (responseText) {
        //     const sentMessage = await whatsapp.sendTextMessage({
        //         sessionId: msg.sessionId,
        //         to: msg.key.remoteJid,
        //         text: responseText
        //     });

        //     // Añadir el ID del mensaje del bot al set para que el handler `fromMe` lo reconozca
        //     if (sentMessage && sentMessage.key && sentMessage.key.id) {
        //         sentBotMessages.add(sentMessage.key.id);
        //         // Limpiar el set después de un tiempo para que no crezca indefinidamente
        //         setTimeout(() => sentBotMessages.delete(sentMessage.key.id), 60000); // 1 minuto
        //     }

        //     console.log(
        //         `\n========== ENVIANDO RESPUESTA (NO GUARDADA AÚN) ==========\n` +
        //         `A: ${user.phone_number}\n` +
        //         `Mensaje: ${responseText}\n` +
        //         `==========================================================\n`
        //     );
        // }
    } catch (error) {
        console.error('Error en onMessageReceived:', error);
    }
});

// Verificar tiempos de espera de agentes periódicamente
setInterval(async () => {
    try {
        const timedOutUsers = await db.checkAgentTimeouts();
        for (const user of timedOutUsers) {
            const message = 'Parece que nuestros asesores están ocupados. Has sido devuelto al menú principal. Envía "hola" para comenzar de nuevo.';
            await whatsapp.sendTextMessage({
                sessionId: 'default', // O la sessionId que corresponda
                to: user.phone_number,
                text: message
            });
            console.log(`Usuario ${user.phone_number} ha vuelto al menú principal por inactividad del agente.`);
        }
    } catch (error) {
        console.error('Error al verificar los tiempos de espera de los agentes:', error);
    }
    console.log('Verificando los tiempos de espera de los agentes...')
}, 60 * 1000); // Se ejecuta cada minuto

// ==================== FIN - LÓGICA DE CHATBOT CON BASE DE DATOS v2 ======================

io.on('connection', (socket) => {
    console.log('connection');

    socket.on('disconnect', (socket) => {
        console.log('Disconnect');
    });
});

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    next();
});

app.get('/', (req, res) => {
    res.json({ success: 1, message: 'Servidor conectado' });
});

app.get('/status', async (req, res) => {
    try {
        let id = req.query.id ? req.query.id : 'default';
        if (whatsapp.getSession(id)) {
            console.log('Sesión iniciada');
            res.json({ success: 1, status: 1, message: 'Sesión iniciada' });

        } else {
            console.log('Sesión no iniciada');
            res.json({ success: 1, status: 0, message: 'Sesión no iniciada' });
        }
    } catch (error) {
        next(error);
    }
});

app.get('/login', async (req, res) => {
    let id = req.query.id ? req.query.id : 'default';
    if (!whatsapp.getSession(id)) {
        await whatsapp.startSession(id);

        whatsapp.onQRUpdated(({ sessionId, qr }) => {
            io.emit(`qr`, { qr, sessionId });
        });

        whatsapp.onConnected((sessionId) => {
            console.log("session connected :" + sessionId);
            io.emit(`login`, { success: 1, sessionId });
        });

        console.log('Iniciando sesión...');
        res.json({ success: 1, status: 1, message: 'Iniciando sesión...' });
    } else {
        console.log('El cliente ya se inicializó');
        res.json({ success: 1, status: 2, message: 'El cliente ya se inicializó' });
    }
});

app.get('/test', async (req, res) => {
    try {
        let id = req.query.id ? req.query.id : 'default';
        let typing = req.query.typing ? req.query.typing : false;
        if (whatsapp.getSession(id)) {
            if (!config.dev.phone) {
                console.log('Número de prueba no definido');
                return res.status(400).json({ success: 0, message: 'Número de prueba no definido' });
            }

            const phone = config.dev.phone;
            const text = `Hola, ${config.dev.name || 'Desarrollador'}`;

            if (typing) {
                await whatsapp.sendTyping({
                    sessionId: id,
                    to: phone,
                    duration: Number(typing),
                });
            }

            await whatsapp.sendTextMessage({
                sessionId: id,
                to: phone,
                text,
            });

            console.log('Mensaje de prueba enviado');
            res.json({ success: 1, status: 1, message: 'Mensaje enviado', phone, text });

        } else {
            console.log('No iniciado');
            res.json({ success: 1, status: 0, message: 'Servidor no iniciado' });
        }
    } catch (error) {
        next(error);
    }
});

app.post('/send', authenticateToken, async(req, res) => {
    try {
        let id = req.query.id ? req.query.id : 'default';

        if(whatsapp.getSession(id)){
            const { phone, text = '', image_url: imageUrl, audio_url: audioUrl, video_url: videoUrl } = req.body;

            if(!phone){
                return res.status(400).json({error: 1, message: 'El parámetro "phone" es requerido'});
            }

            const logEntry = { phone, text, imageUrl, audioUrl, videoUrl, date: new Date().toJSON() };

            let sentMessageInfo;

            if(!imageUrl && !audioUrl && !videoUrl){
                await whatsapp.sendTextMessage({
                    sessionId: id,
                    to: phone,
                    text
                });
                sentMessageInfo = { phone, text };
            }else if(imageUrl){
                await whatsapp.sendImage({
                    sessionId: id,
                    to: phone,
                    text,
                    media: imageUrl
                });
                sentMessageInfo = { phone, text, imageUrl };
            }else if(audioUrl){
                await whatsapp.sendVoiceNote({
                    sessionId: id,
                    to: phone,
                    media: audioUrl
                });
                sentMessageInfo = { phone, audioUrl };
            }else if(videoUrl){
                await whatsapp.sendVideo({
                    sessionId: id,
                    to: phone,
                    text,
                    media: videoUrl
                });
                sentMessageInfo = { phone, text, videoUrl };
            }

            registerLog('messages.log', JSON.stringify(logEntry) + ',\n');
            console.log("Mensaje enviado");
            res.json({success: 1, message: 'Mensaje enviado', ...sentMessageInfo});

        }else{
            console.log('No iniciado');
            res.status(404).json({success: 0, message: 'Sesión no iniciada'});
        }
    } catch (error) {
        next(error);
    }        
});

// Middleware para manejo de errores centralizado
app.use((err, req, res, next) => {
    console.error(err);
    const logEntry = { details: err.stack || err.message, date: new Date().toJSON() };
    registerLog('error.log', JSON.stringify(logEntry) + ',\n');
    res.status(500).json({ error: 1, message: 'Error en el servidor' });
});
  
server.listen(config.port, () => {
    console.log(`${config.name} escuchando el puerto ${config.port}`);
    if (config.env !== 'dev') {
        console.log(`Servidor en modo producción. Asegúrate de que un proxy inverso (como Nginx) esté manejando HTTPS para el dominio ${config.domain}.`);
    }
});

// ====================

function registerLog(file, text) {
    try {
        const logPath = path.join(__dirname, file);
        fs.appendFile(logPath, text, (err) => {
            if (err) console.error(`Error al escribir en el log ${file}:`, err);
        });
    } catch (error) {
        console.error(`Error catastrófico en registerLog para ${file}:`, error);
    }
}

process.on("SIGINT", async () => {
    console.log("\nApagando...");
    await db.pool.end(); // Close the database pool
    io.emit(`shutdown`, { success: 1 });
    process.exit(0);
});