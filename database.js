const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const initDb = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('Conectado a la base de datos MySQL.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone_number VARCHAR(255) NOT NULL UNIQUE,
        state VARCHAR(255) DEFAULT 'initial',
        last_interaction_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Se ha cambiado la columna sent_by_bot por source
    await connection.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        message_text TEXT,
        source ENUM('user', 'bot', 'manual') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    connection.release();
    console.log('Tablas "users" y "messages" (esquema actualizado) verificadas/creadas correctamente.');
  } catch (error) {
    console.error('No se pudo inicializar la base de datos:', error);
    process.exit(1); // Salir si no se puede conectar a la DB
  }
};

const findOrCreateUser = async (phoneNumber) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE phone_number = ?', [phoneNumber]);
  if (rows.length > 0) {
    return rows[0];
  }
  const [result] = await pool.query('INSERT INTO users (phone_number) VALUES (?)', [phoneNumber]);
  const [newUser] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return newUser[0];
};

const updateUserState = async (userId, state) => {
  await pool.query('UPDATE users SET state = ? WHERE id = ?', [state, userId]);
};

const updateUserInteractionTime = async (userId) => {
  await pool.query('UPDATE users SET last_interaction_at = NOW() WHERE id = ?', [userId]);
};

const checkAgentTimeouts = async () => {
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  const [users] = await pool.query(
    'SELECT * FROM users WHERE state = ? AND last_interaction_at < ?',
    ['awaiting_agent', thirtyMinutesAgo]
  );

  for (const user of users) {
    await updateUserState(user.id, 'initial');
  }
  return users; // Devuelve los usuarios cuyo estado se ha reseteado
};


// Se ha cambiado el parámetro sentByBot por source
const saveMessage = async (userId, messageText, source) => {
  await pool.query(
    'INSERT INTO messages (user_id, message_text, source) VALUES (?, ?, ?)',
    [userId, messageText, source]
  );
};


module.exports = {
  initDb,
  findOrCreateUser,
  updateUserState,
  saveMessage,
  pool,
  updateUserInteractionTime,
  checkAgentTimeouts,
};