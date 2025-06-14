import express from 'express';
import mysql from 'mysql2';
import cors from 'cors';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import speechToTextRoutes from './routes/speechToText.js';
import translationRoutes from './routes/translation.js';
import prescriptionRoutes from './routes/prescription.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: 3306
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL');

  // Create users table if it doesn't exist
  const createUsersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      user_type ENUM('admin', 'doctor') NOT NULL,
      specialization VARCHAR(255) NULL,
      hospital VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `;

  db.query(createUsersTable, (err) => {
    if (err) {
      console.error('Error creating users table:', err);
    } else {
      console.log('Users table ready');
    }
  });
});

// Signup endpoint
app.post('/api/signup', async (req, res) => {
  console.log('Signup request received:', req.body);
  const { name, email, password, userType, specialization, hospital } = req.body;

  // Validate required fields
  if (!name || !email || !password || !userType) {
    console.log('Missing required fields:', { name: !!name, email: !!email, password: !!password, userType: !!userType });
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (userType === 'doctor' && (!specialization || !hospital)) {
    console.log('Missing doctor fields:', { specialization: !!specialization, hospital: !!hospital });
    return res.status(400).json({ error: 'Specialization and hospital required for doctors' });
  }
  if (userType !== 'admin' && userType !== 'doctor') {
    console.log('Invalid user type:', userType);
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    console.log('Password hashed successfully');

    // Insert user into database
    const query = `
      INSERT INTO users (name, email, password, user_type, specialization, hospital)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const values = [
      name,
      email,
      hashedPassword,
      userType,
      userType === 'doctor' ? specialization : null,
      userType === 'doctor' ? hospital : null
    ];

    console.log('Executing database query with values:', [name, email, '[HIDDEN]', userType, specialization, hospital]);

    db.query(query, values, (err, result) => {
      if (err) {
        console.error('Database error:', err);
        if (err.code === 'ER_DUP_ENTRY') {
          return res.status(400).json({ error: 'Email already exists' });
        }
        if (err.code === 'ER_NO_SUCH_TABLE') {
          return res.status(500).json({ error: 'Database table not found. Please contact administrator.' });
        }
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }
      console.log('User created successfully with ID:', result.insertId);
      res.status(201).json({ message: 'User created successfully', id: result.insertId });
    });
  } catch (error) {
    console.error('Server error in signup:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  console.log('Login request received:', { email: req.body.email, userType: req.body.userType });
  const { email, password, userType } = req.body;

  // Validate required fields
  if (!email || !password || !userType) {
    console.log('Missing required fields in login:', { email: !!email, password: !!password, userType: !!userType });
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (userType !== 'admin' && userType !== 'doctor') {
    console.log('Invalid user type in login:', userType);
    return res.status(400).json({ error: 'Invalid user type' });
  }

  try {
    // Query the database for the user
    const query = 'SELECT * FROM users WHERE email = ? AND user_type = ?';
    console.log('Executing login query for:', email, userType);

    db.query(query, [email, userType], async (err, results) => {
      if (err) {
        console.error('Database error in login:', err);
        return res.status(500).json({ error: 'Database error: ' + err.message });
      }

      console.log('Login query results count:', results.length);

      // Check if user exists
      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid email, user type, or password' });
      }

      const user = results[0];

      // Compare password
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        console.log('Password mismatch for user:', email);
        return res.status(401).json({ error: 'Invalid email, user type, or password' });
      }

      console.log('Login successful for user:', email);
      // Successful login
      res.status(200).json({
        message: 'Login successful',
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          userType: user.user_type
        }
      });
    });
  } catch (error) {
    console.error('Server error in login:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'Backend is working!',
    timestamp: new Date().toISOString(),
    database: db.state === 'authenticated' ? 'connected' : 'disconnected'
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    database: db.state === 'authenticated' ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/speech', speechToTextRoutes);
app.use('/api/translate', translationRoutes);
app.use('/api/prescription', prescriptionRoutes);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
