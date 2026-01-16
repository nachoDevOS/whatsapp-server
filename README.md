<h1 align="center">WhatsApp-API</h1>

> Servidor de WhatsApp para envío de mensajes desde la web.

## Requesitos
- Nodejs >= 22

## Install
```sh
npm install
```
## Config
```sh
cp .env-example .env

# Edit environment variables
APP_NAME="WhatsApp API"
APP_ENV="dev" # prod for production environment
APP_DOMAIN=example.com # your domain without http or https (example.com)
APP_PORT=3002 # your port
```

## Start dev
```sh
npm start
```

## Start prod
```sh
//Para prueba
npm start

//Para ejecutar en segundo plano
pm2 start index.js --name "Whastapp API"
```

## Error Puppeteer 
El error es clásico de Puppeteer/Chrome en servidores Linux. Falta instalar las dependencias del sistema necesarias para que Chrome funcione.
## Solución: Instalar dependencias faltantes
```sh
sudo apt update
sudo apt install -y \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    gconf-service \
    libgconf-2-4 \
    libappindicator1
```

## Opción alternativa (más completo):
```sh
# Instalar todas las dependencias comúnmente necesarias
sudo apt install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils
```

## Limpiar cache de Puppeteer y reinstalar:
```sh
# Limpiar cache
rm -rf ~/.cache/puppeteer

# Reinstalar puppeteer (opcional)
npm install puppeteer@latest
```

## Si usas una versión específica de Chrome:
```sh
# Forzar descarga de Chrome nuevamente
npm rebuild
```

## Routes
<table>
    <tr>
        <th>TYPE</th>
        <th>ROUTE</th>
        <th>PARAMS</th>
        <th>RETURN</th>
    </tr>
    <tr>
        <td>GET</td>
        <td>/</td>
        <td></td>
        <td>OBJECT</td>
    </tr>
    <tr>
        <td>GET</td>
        <td>/status</td>
        <td></td>
        <td>OBJECT</td>
    </tr>
    <tr>
        <td>GET</td>
        <td>/login</td>
        <td></td>
        <td>OBJECT</td>
    </tr>
    <tr>
        <td>GET</td>
        <td>/logout</td>
        <td></td>
        <td>OBJECT</td>
    </tr>
    <tr>
        <td>GET</td>
        <td>/test</td>
        <td></td>
        <td>OBJECT</td>
    </tr>
    <tr>
        <td>POST</td>
        <td>/send</td>
        <td>{phone: "59175199157", text: "Hello", image_url: "https://my_image_url"}</td>
        <td>OBJECT</td>
    </tr>
    <tr>
        <td>GET</td>
        <td>/history/:contact_id</td>
        <td>Query: limit (optional, default 50)</td>
        <td>OBJECT (Chat History)</td>
    </tr>
    <tr>
        <td>GET</td>
        <td>/history/group/:groupJid</td>
        <td>Query: limit (optional, default 50)</td>
        <td>OBJECT (Group History)</td>
    </tr>
</table>

## Credits
<a href="https://www.facebook.com/ignaciomolinaguzman20?locale=es_LA" target="_blank">@Ignacio</a>  -   Developer"# whatsapp-server" 
"# whatsapp-server" 
