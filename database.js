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
      CREATE TABLE IF NOT EXISTS sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        contact_id VARCHAR(255) NOT NULL,
        phone_number VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        state VARCHAR(255) DEFAULT 'initial',
        last_interaction_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_session (contact_id, session_id)
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

    // --- NUEVAS TABLAS PARA GRUPOS ---
    await connection.query(`
      CREATE TABLE IF NOT EXISTS groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_jid VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
        UNIQUE KEY unique_group_session (group_jid, session_id)
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS group_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT,
        sender_jid VARCHAR(255),
        message_text TEXT,
        source ENUM('user', 'bot', 'manual') NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id)
      )
    `);

    connection.release();
    console.log('Tablas de base de datos (users, messages, groups, group_messages) verificadas/creadas correctamente.');
  } catch (error) {
    console.error('No se pudo inicializar la base de datos:', error);
    process.exit(1); // Salir si no se puede conectar a la DB
  }
};

const findOrCreateUser = async (contactId, sessionId) => {
  await pool.query('INSERT IGNORE INTO sessions (session_id) VALUES (?)', [sessionId]);

  let phoneNumber = contactId.split('@')[0];
  phoneNumber = phoneNumber.split(':')[0]; // Asegura que solo quede el número (quita :1 si existe)

  const [rows] = await pool.query('SELECT * FROM users WHERE contact_id = ? AND session_id = ?', [contactId, sessionId]);
  if (rows.length > 0) {
    const user = rows[0];
    // Si el usuario ya existe pero tiene el ID guardado en phone_number (corrección de datos antiguos)
    if (user.phone_number.includes('@')) {
      await pool.query('UPDATE users SET phone_number = ? WHERE id = ?', [phoneNumber, user.id]);
      user.phone_number = phoneNumber;
    }
    return user;
  }

  const [result] = await pool.query('INSERT INTO users (contact_id, phone_number, session_id) VALUES (?, ?, ?)', [contactId, phoneNumber, sessionId]);
  const [newUser] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return newUser[0];
};

const findOrCreateGroup = async (groupJid, sessionId) => {
  await pool.query('INSERT IGNORE INTO sessions (session_id) VALUES (?)', [sessionId]);
  const [rows] = await pool.query('SELECT * FROM groups WHERE group_jid = ? AND session_id = ?', [groupJid, sessionId]);
  if (rows.length > 0) return rows[0];
  
  const [result] = await pool.query('INSERT INTO groups (group_jid, session_id) VALUES (?, ?)', [groupJid, sessionId]);
  const [newGroup] = await pool.query('SELECT * FROM groups WHERE id = ?', [result.insertId]);
  return newGroup[0];
};

const saveGroupMessage = async (groupId, senderJid, messageText, source) => {
  await pool.query(
    'INSERT INTO group_messages (group_id, sender_jid, message_text, source) VALUES (?, ?, ?, ?)',
    [groupId, senderJid, messageText, source]
  );
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
  findOrCreateGroup,
  updateUserState,
  saveMessage,
  saveGroupMessage,
  pool,
  updateUserInteractionTime,
  checkAgentTimeouts,
};