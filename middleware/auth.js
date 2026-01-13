// middleware/auth.js
require('dotenv').config();
const axios = require('axios');

const authenticateToken = async (req, res, next) => {
    const token_api = process.env.TOKEN_API;
    const url_validation = process.env.TOKEN_VALIDATION_URL; // URL del servicio de validación de tokens
    const url_invalidation = process.env.TOKEN_INVALIDATION_URL; // URL del servicio de invalidación de tokens

    if (token_api!='true') {
        console.log('Development environment: skipping token validation.');
        return next();
    }

    // Obtener token del encabezado de autorización, ej: "Bearer <token>"
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    // Verificar si el token está presente
    if (token == null) {
        console.log('Authorization token not found.');
        return res.status(401).json({ success: false, message: 'Authorization token not found. It must be provided in the Authorization header as "Bearer <token>".' });
    }

    try {
        // Configurar los headers para la solicitud de validación
        const config = {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        // Realizar la solicitud GET para validar el token
        const response = await axios.get(url_validation, config);

        // Si la respuesta es 200 y el token es válido
        if (response.status === 200 && response.data.isValid) {
            console.log('___________________TOKEN VALIDADO___________________________');
            console.log('success: '+response.data.isValid);// true o false si esta vigente el token
            console.log('status: '+response.status); // 200 si todo sale correcto
            console.log('expiresAt: '+response.data.data['expiresAt']);
            console.log('Token is valid, proceeding...');

            // Define el objeto de datos. En este caso, vacío.
            const data = {};
            // Realiza la solicitud POST para invalidar el token
            
            axios.post(url_invalidation, data, config);
            console.log('___________________TOKEN INVALIDO');


            next(); // Pasar el control al siguiente manejador
        } else {
            // Si la respuesta no es 200 o el token no es válido
            console.log('Invalid token.');
            res.status(401).json({ success: false, message: 'Invalid token.' });
        }
    } catch (error) {
        console.error('An error occurred during token validation:');
        if (error.response) {
            // El servidor de validación respondió con un código de estado de error
            console.error('Error data:', error.response.data);
            console.error('Error status:', error.response.status);
            return res.status(error.response.status).json({ success: false, message: 'Token validation failed.', details: error.response.data });
        } else if (error.request) {
            // La solicitud se hizo pero no se recibió respuesta
            console.error('No response received from validation server.');
            return res.status(500).json({ success: false, message: 'Error validating token: No response from validation server.' });
        } else {
            // Algo más causó el error
            console.error('Error message:', error.message);
            return res.status(500).json({ success: false, message: 'Internal server error during token validation.' });
        }
    }
};

module.exports = authenticateToken;