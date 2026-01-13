// const express = require('express');
// const app = express();
// const http = require('http');
// const path = require('path');
// const fs = require('fs');
// const bodyParser = require('body-parser');

// require('dotenv').config();

// const PORT = process.env.APP_PORT;
// const ENV = process.env.APP_ENV;
// const DOMAIN = process.env.APP_DOMAIN;
// const NAME = process.env.APP_NAME;
// const DEV_PHONE = process.env.DEV_PHONE;
// const DEV_NAME = process.env.DEV_NAME;

// // Cliente de whatsapp
// const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
// const qrcode = require("qrcode-terminal");

// const server = ENV == 'dev' ? http.createServer(app) : http.createServer(app, {
//     key: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/privkey.pem`),
//     cert: fs.readFileSync(`/etc/letsencrypt/live/${DOMAIN}/fullchain.pem`)
// });

// const io = require('socket.io')(server, {
//     cors: { origin: "*"}
// });

// app.use(bodyParser.json());
// var client;

// io.on('connection', (socket) => {
//     console.log('connection');

//     socket.on('disconnect', (socket) => {
//         console.log('Disconnect');
//     });
// });

// app.use(function (req, res, next) {
//     res.setHeader('Access-Control-Allow-Origin', '*');
//     res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
//     res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
//     res.setHeader('Access-Control-Allow-Credentials', true);
//     next();
// });

// app.get('/', (req, res) => {
//     res.json({success: 1, message: 'Servidor conectado'});
// });

// app.get('/status', (req, res) => {
//     try {
//         if (!client) {
//             console.log('No iniciado');
//             res.json({success: 1, status: 0, message: 'No iniciado'});
//             return 0;
//         }
//         if(client.pupPage) {
//             console.log('Estado online');
//             res.json({success: 1, status: 1, message: 'online'});
//         } else {
//             console.log('Estado offline');
//             res.json({success: 1, status: 0, message: 'offline'});
//         }
//     } catch (error) {
//         const date = new Date().toJSON();
//         registerLog('error.log', `{details: "${JSON.stringify(error)}", date: "${date}"}\n`);
//         res.json({error: 1, message: 'Error en el servidor'});
//     }
// });

// app.get('/login', (req, res) => {
//     if(!client) {
//         try {
//             client = ENV == 'dev' ? new Client({authStrategy: new LocalAuth(), qrMaxRetries: 5}) : new Client({authStrategy: new LocalAuth(), qrMaxRetries: 5, puppeteer: {headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox']} });
        
//             client.on('qr', (qr) => {
//                 console.log('Generando QR');
//                 qrcode.generate(qr, { small: true });
//                 io.emit(`qr`, {qr});
//             });
            
//             client.on('ready', () => {
//                 console.log('Sesión iniciada');
//                 io.emit(`login`, {success: 1});
//             });

//             client.on('disconnected', (reason) => {
//                 client = null;
//                 io.emit(`disconnected`, {reason});
//                 console.log('Client was logged out', reason);
//             });
            
//             client.initialize();
//             console.log('Iniciando sesión...');
//             res.json({success: 1, status: 1, message: 'Iniciando sesión...'});
//         } catch (error) {
//             const date = new Date().toJSON();
//             registerLog('error.log', `{details: "${JSON.stringify(error)}", date: "${date}"}\n`);
//             res.json({error: 1, message: 'Error en el servidor'});
//         }
//     } else {
//         console.log('El cliente ya se inicializó');
//         res.json({success: 1, status: 2, message: 'El cliente ya se inicializó'});
//     }
// });

// app.get('/logout', async (req, res) => {
//     if (!client) {
//         console.log('No iniciado');
//         res.json({success: 1, status: 0, message: 'No iniciado'});
//         return 0;
//     }
    
//     if (client) {
//         if(client){
//             await client.logout();
//             await client.destroy();
//             io.emit(`logout`, {success: 1});
//             client = null;
//         }
//         console.log('Sesión cerrada');
//         res.json({success: 1, message: 'Sesión cerrada'});
//     }
// });

// app.get('/test', (req, res) => {
//     try {
//         if (!client) {
//             console.log('No iniciado');
//             res.json({success: 1, status: 0, message: 'No iniciado'});
//             return 0;
//         }

//         if (DEV_PHONE == '') {
//             console.log('Número de prueba no definido');
//             res.json({success: 1, status: 0, message: 'Número de prueba no definido'});
//             return 0;
//         }

//         if(client.pupPage) {
//             const date = new Date().toJSON();
//             var phone = DEV_PHONE;
//             var text = `Hola, ${DEV_NAME ? DEV_NAME : 'Desarrollador'}`;
//             if(phone && text){
//                 let chatId = `${phone}@c.us`;
//                 client.sendMessage(chatId, text).then((response) => {
//                     console.log("Mensaje enviado");
//                     registerLog('test.log', `{phone: "${phone}", text: "${text}", date: "${date}"}\n`);
//                 });
//                 res.json({success: 1, message: 'Mensaje enviado', phone, text});
//             }else{
//                 res.json({error: 1, message: 'Mensaje no enviado'});
//             }
//         } else {
//             console.log('No iniciado');
//             res.json({success: 1, status: 0, message: 'No iniciado'});
//         }
//     } catch (error) {
//         const date = new Date().toJSON();
//         registerLog('error.log', `{details: "${JSON.stringify(error)}", date: "${date}"}\n`);
//         res.json({error: 1, message: 'Error en el servidor'});
//     }
// });

// app.post('/send', async(req, res) => {
//     try {
//         if (!client) {
//             console.log('No iniciado');
//             res.json({success: 1, status: 0, message: 'No iniciado'});
//             return 0;
//         }
//         if(client.pupPage) {
//             const date = new Date().toJSON();
//             var phone = req.body.phone;
//             var text = req.body.text ? req.body.text : '';
//             var imageUrl = req.body.image_url ? req.body.image_url : '';
//             if(phone){
//                 let chatId = `${phone}@c.us`;
//                 if (text && !imageUrl) {
//                     client.sendMessage(chatId, text).then((response) => {
//                         console.log("Mensaje enviado");
//                         registerLog('messages.log', `{phone: "${phone}", text: "${text}", imageUrl: "${imageUrl}", date: "${date}"}\n`);
//                     });
//                     res.json({success: 1, message: 'Mensaje enviado', phone, text});
//                 } else if (imageUrl) {
//                     const media = await MessageMedia.fromUrl(imageUrl);
//                     client.sendMessage(chatId, media, {caption: text ? text : ''}).then((response) => {
//                         console.log("Mensaje enviado");
//                         registerLog('messages.log', `{phone: "${phone}", text: "${text}", imageUrl: "${imageUrl}", date: "${date}"}\n`);
//                     });
//                     res.json({success: 1, message: 'Mensaje enviado', phone, text});
//                 } else {
//                     console.log("Mensaje vacío");
//                 }
                
//             }else{
//                 res.json({error: 1, message: 'Mensaje no enviado'});
//             }
//         } else {
//             console.log('No iniciado');
//             res.json({success: 1, status: 0, message: 'No iniciado'});
//         }
//     } catch (error) {
//         const date = new Date().toJSON();
//         registerLog('error.log', `{details: "${JSON.stringify(error)}", date: "${date}"}\n`);
//         res.json({error: 1, message: 'Error en el servidor'});
//     }
                
// });
  
// server.listen(PORT, () => {
//     console.log(`${NAME} escuchando el puerto ${PORT}`)
// });

// // ====================

// function registerLog(file, text) {
//     try {
//         fs.writeFile(path.join(__dirname, '/', file), text, {flag: 'a+'}, err => {
//             if (err) {
//               console.error(err);
//             }
//         });
//     } catch (err) {
//         console.error(err);
//     }
// }

// process.on("SIGINT", async () => {
//     console.log("\nApagando...");
//     if(client){
//         await client.destroy();
//     }
//     io.emit(`shutdown`, {success: 1});
//     process.exit(0);
// });