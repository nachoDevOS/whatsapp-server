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

// ==================== FUNCIONES ANTI-BAN ====================
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Función Spintax: Elige variaciones de palabras al azar. Ej: {Hola|Buenas}
const spintax = (text) => {
    const regex = /\{([^{}]+)\}/g;
    return text.replace(regex, (match, content) => {
        const choices = content.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
    });
};

const randomizeText = (text) => {
    if (!text) return text;
    
    // Genera una firma única invisible usando una combinación de caracteres de control
    const invisibleChars = [
        '\u200B', '\u200C', '\u200D', '\u2060', 
        '\u2061', '\u2062', '\u2063', '\u2064', '\u206E', '\u206F'
    ];
    const randomChar = () => invisibleChars[Math.floor(Math.random() * invisibleChars.length)];

    let prefix = '';
    let suffix = '';
    // Agrega caracteres invisibles al inicio y final para que el hash del mensaje sea único
    for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) prefix += randomChar();
    for (let i = 0; i < Math.floor(Math.random() * 3) + 1; i++) suffix += randomChar();
    
    // 1. Primero procesamos el Spintax (variación visual) y aseguramos que sea texto
    const processedText = spintax(String(text));

    // 2. Luego agregamos la capa invisible (variación de código)
    const result = prefix + processedText + suffix;

    // Generamos una vista de depuración para ver los caracteres invisibles
    const debugView = result.split('').map(char => {
        const code = char.charCodeAt(0);
        // Si es un caracter estándar (letras, números), lo mostramos. Si es especial, mostramos su código Unicode.
        return (code >= 32 && code <= 126) ? char : `[\\u${code.toString(16).toUpperCase().padStart(4, '0')}]`;
    }).join('');

    console.log(`[Anti-Ban] Enviando (Estructura Real): ${debugView}`);
    
    return result;
};

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
        // 1. FILTRO INICIAL: Ignorar solo mensajes de Estados (Broadcast). Permitir grupos.
        if (msg.key.remoteJid === 'status@broadcast') {
            return;
        }

        let messageText = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        const messageType = Object.keys(msg.message || {})[0] || 'unknown';
        const wamId = msg.key.id;
        const timestamp = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : (msg.messageTimestamp?.low || Date.now() / 1000);

        // --- MEJORA: Manejar mensajes que no son de texto para guardarlos en la DB ---
        // Si no hay texto, pero es un mensaje multimedia, asignamos un placeholder para el frontend.
        if (!messageText && messageType !== 'protocolMessage' && messageType !== 'senderKeyDistributionMessage') {
            if (messageType === 'imageMessage') messageText = msg.message.imageMessage.caption || '[Imagen]';
            else if (messageType === 'videoMessage') messageText = msg.message.videoMessage.caption || '[Video]';
            else if (messageType === 'audioMessage') messageText = '[Audio]';
            else if (messageType === 'documentMessage') messageText = msg.message.documentMessage.fileName || '[Documento]';
            else if (messageType === 'stickerMessage') messageText = '[Sticker]';
            else if (messageType === 'contactMessage') messageText = '[Contacto]';
            else if (messageType === 'locationMessage') messageText = '[Ubicación]';
            else messageText = `[Mensaje tipo: ${messageType}]`; // Para futuros tipos de mensaje
        }

        // ==================== LÓGICA PARA GRUPOS ====================
        if (msg.key.remoteJid.endsWith('@g.us')) {
            const group = await db.findOrCreateGroup(msg.key.remoteJid, msg.sessionId);
            if (wamId) { // Guardar cualquier tipo de mensaje, no solo texto
                let source = 'user';
                let sender = msg.key.participant || msg.participant;
                let senderPushName = msg.pushName;

                if (msg.key.fromMe) {
                    sender = 'me'; // O el ID del bot si estuviera disponible
                    if (sentBotMessages.has(msg.key.id)) {
                        source = 'bot';
                        sentBotMessages.delete(msg.key.id);
                    } else {
                        source = 'manual';
                    }
                }

                await db.saveGroupMessage(group.id, sender, messageText, source, wamId, messageType, timestamp, senderPushName);
                console.log(
                    `\n========== MENSAJE DE GRUPO GUARDADO (DB) ==========\n` +
                    `Grupo: ${group.group_jid}\n` +
                    `De: ${sender}\n` +
                    `Mensaje: ${messageText}\n` +
                    `====================================================\n`
                );
            }
            return; // DETENER AQUÍ: No ejecutar lógica de chatbot individual para grupos
        }

        // ==================== LÓGICA PARA CONTACTOS INDIVIDUALES ====================
        // Corrección de ID: Si existe 'participant' (común en grupos o para resolver LIDs), usarlo como ID real.
        let contactId = msg.key.remoteJid;
        if (!msg.key.fromMe) {
            if (msg.key.participant) {
                contactId = msg.key.participant;
            } else if (msg.participant) {
                contactId = msg.participant;
            }
        }

        const user = await db.findOrCreateUser(contactId, msg.sessionId, msg.pushName);

        // --- INICIO DE LA NUEVA LÓGICA DE ENRUTAMIENTO ---

        // 1. El usuario está en una conversación con un agente (CUANDO EL USUARIO DECIDE CONTACTARSE CON UN AGENTE)
        if (user.state === 'awaiting_agent') {
            await db.updateUserInteractionTime(user.id); // Actualizar para el timeout

            if (msg.key.fromMe) {
                // Es un mensaje del agente (manual)
                if (wamId && !sentBotMessages.has(msg.key.id)) {
                    await db.saveMessage(user.id, messageText, 'manual', wamId, messageType, timestamp);
                    console.log(
                        `\n========== MENSAJE DE AGENTE (A USUARIO)GUARDADO (DB) ==========\n` +
                        `A: ${user.phone_number}\n` +
                        `Mensaje: ${messageText}\n` +
                        `==================================================\n`
                    );
                }
            } else {
                // Es un mensaje del usuario para el agente
                if (wamId) {
                    await db.saveMessage(user.id, messageText, 'user', wamId, messageType, timestamp);
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
            if (!wamId) return; // Si no hay ID de mensaje, no hay nada que guardar

            if (sentBotMessages.has(msg.key.id)) {
                // Es un eco de una respuesta del bot QUE YA FUE GUARDADA
                // No guardamos de nuevo para evitar duplicados, pero confirmamos el evento.
                console.log(
                    `\n========== RESPUESTA DE BOT CONFIRMADA (YA GUARDADA) ==========\n` +
                    `A: ${user.phone_number}\n` +
                    `ID: ${msg.key.id}\n` +
                    `=============================================================\n`
                );
                sentBotMessages.delete(msg.key.id);
            } else {
                // Es un mensaje manual, pero el usuario no estaba en modo agente
                await db.saveMessage(user.id, messageText, 'manual', wamId, messageType, timestamp);
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
        if (!wamId) {
            return; // Ignorar si no hay un ID de mensaje válido
        }

        // Guardar mensaje del usuario
        await db.saveMessage(user.id, messageText, 'user', wamId, messageType, timestamp);

        console.log(
            `\n========== MENSAJE RECIBIDO (DB) ==========\n` +
            `De: ${user.phone_number} (Estado: ${user.state})\n` +
            `Mensaje: ${messageText}\n` +
            `=========================================\n`
        );

        // Si el mensaje no tiene texto procesable para el bot (ej. es solo una imagen), no continuar.
        const lowerCaseMessage = (messageText || '').toLowerCase().trim();
        if (!lowerCaseMessage || lowerCaseMessage.startsWith('[')) {
            return;
        }

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

        // Enviar respuesta y guardarla
        // if (responseText) {
        //     const textToSend = randomizeText(responseText);
        //     const sentMessage = await whatsapp.sendTextMessage({
        //         sessionId: msg.sessionId,
        //         to: msg.key.remoteJid,
        //         text: textToSend
        //     });

        //     // Añadir el ID del mensaje del bot al set para que el handler `fromMe` lo reconozca
        //     if (sentMessage && sentMessage.key && sentMessage.key.id) {
        //         sentBotMessages.add(sentMessage.key.id);
                
        //         // GUARDAR INMEDIATAMENTE para asegurar que se guarda el texto con el código anti-ban
        //         const sentTimestamp = Math.floor(Date.now() / 1000);
        //         await db.saveMessage(user.id, textToSend, 'bot', sentMessage.key.id, 'conversation', sentTimestamp);

        //         // Limpiar el set después de un tiempo para que no crezca indefinidamente
        //         setTimeout(() => sentBotMessages.delete(sentMessage.key.id), 60000); // 1 minuto
        //     }

        //     console.log(
        //         `\n========== ENVIANDO RESPUESTA (GUARDADA CON ANTI-BAN) ==========\n` +
        //         `A: ${user.phone_number}\n` +
        //         `Mensaje Real: ${textToSend}\n` + 
        //         `================================================================\n`
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
            await sleep(Math.floor(Math.random() * 1000) + 500); // Pausa aleatoria entre usuarios
            const message = 'Parece que nuestros asesores están ocupados. Has sido devuelto al menú principal. Envía "hola" para comenzar de nuevo.';
            const textToSend = randomizeText(message);
            
            const sentMessage = await whatsapp.sendTextMessage({
                sessionId: user.session_id,
                to: user.contact_id,
                text: textToSend
            });
            
            if (sentMessage && sentMessage.key && sentMessage.key.id) {
                sentBotMessages.add(sentMessage.key.id);
                const sentTimestamp = Math.floor(Date.now() / 1000);
                await db.saveMessage(user.id, textToSend, 'bot', sentMessage.key.id, 'conversation', sentTimestamp);
                setTimeout(() => sentBotMessages.delete(sentMessage.key.id), 60000);
            }
            
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

// Para iniciar sesion en los QR
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

            // Pausa natural si no hay typing explícito
            if (!typing) await sleep(Math.floor(Math.random() * 1000) + 500);

            await whatsapp.sendTextMessage({
                sessionId: id,
                to: phone,
                text: randomizeText(text),
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

            // Limpieza de seguridad: Asegurar que es string y quitar espacios accidentales del frontend
            const cleanText = String(text || '').trim();

            // 1. Pausa aleatoria para simular comportamiento humano (entre 1s y 3s) antes de procesar
            await sleep(Math.floor(Math.random() * 2000) + 1000);

            // 2. Randomizar el texto para evitar firmas MD5 idénticas (anti-spam)
            const safeText = randomizeText(cleanText);

            const logEntry = { phone, text, imageUrl, audioUrl, videoUrl, date: new Date().toJSON() };

            let sentMessageInfo;

            if(!imageUrl && !audioUrl && !videoUrl){
                await whatsapp.sendTextMessage({
                    sessionId: id,
                    to: phone,
                    text: safeText
                });
                sentMessageInfo = { phone, text };
            }else if(imageUrl){
                await whatsapp.sendImage({
                    sessionId: id,
                    to: phone,
                    text: safeText,
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
                    text: safeText,
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